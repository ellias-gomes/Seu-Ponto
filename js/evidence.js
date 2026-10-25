/**
 * Módulo de Comprovação de Trabalho & Coleta Forense de Ambiente
 * - Extração de IP Público / Saída VPN, ISP, ASN, Localização (com múltiplos fallbacks)
 * - Extração de IP Local / Interface via WebRTC + Servidor Local Opcional
 * - Detecção de Windows 11, Monitores, Bateria, Rede e Fuso Horário
 * - Captura de Tela Nativa (getDisplayMedia) em Sessão Contínua (1 clique) ou Pontual + Colar (Ctrl+V)
 * - Carimbo Técnico na Imagem + Assinatura Criptográfica SHA-256
 */

const EvidenceCollector = {
  activeScreenStream: null,
  activeVideoElement: null,
  cachedNetworkInfo: null,
  lastNetworkFetch: 0,

  // ==================== HASH SHA-256 ====================
  async sha256(message) {
    const msgBuffer = new TextEncoder().encode(message || '');
    if (window.crypto && window.crypto.subtle) {
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback determinístico caso rodado em contexto não-seguro antigo
    let h1 = 0xdeadbeef ^ message.length;
    let h2 = 0x41c6ce57 ^ message.length;
    for (let i = 0, ch; i < message.length; i++) {
      ch = message.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  },

  // ==================== EXTRAÇÃO DE IP LOCAL (WEBRTC) ====================
  async getLocalIPsViaWebRTC(timeoutMs = 1800) {
    return new Promise(resolve => {
      const ips = new Set();
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve(Array.from(ips));
        }
      };

      const timer = setTimeout(finish, timeoutMs);

      try {
        const RTCPeer = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        if (!RTCPeer) {
          clearTimeout(timer);
          return resolve([]);
        }
        const pc = new RTCPeer({ iceServers: [] });
        pc.createDataChannel('');
        pc.onicecandidate = e => {
          if (!e || !e.candidate || !e.candidate.candidate) {
            clearTimeout(timer);
            try { pc.close(); } catch (_) {}
            return finish();
          }
          const cand = e.candidate.candidate;
          const ipRegex = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/gi;
          const matches = cand.match(ipRegex);
          if (matches) {
            matches.forEach(ip => {
              if (ip !== '0.0.0.0' && !ip.startsWith('127.')) {
                ips.add(ip);
              }
            });
          }
          // Captura endereço mDNS (.local) se o navegador mascarar o IP privado
          const mdnsMatch = cand.match(/([a-zA-Z0-9-]+\.local)/);
          if (mdnsMatch && ips.size === 0) {
            ips.add(mdnsMatch[1]);
          }
        };
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer))
          .catch(() => {
            clearTimeout(timer);
            finish();
          });
      } catch (_) {
        clearTimeout(timer);
        finish();
      }
    });
  },

  // ==================== EXTRAÇÃO DE IP PÚBLICO / VPN / ASN ====================
  async getNetworkAndVPNInfo(vpnTermosConhecidos = '', forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedNetworkInfo && (now - this.lastNetworkFetch < 45000)) {
      return this._evaluateVPNStatus(this.cachedNetworkInfo, vpnTermosConhecidos);
    }

    const info = {
      ip_publico: '',
      ip_local_webrtc: '',
      hostname_local: '',
      interfaces_locais: [],
      isp_org: '',
      asn: '',
      cidade_uf: '',
      pais: '',
      vpn_detectada: false,
      motivo_vpn: ''
    };

    // 1. Tenta consultar endpoint local se estiver rodando via servidor_local.py (traz IPs exatos da placa da VPN no Windows e Linux)
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 900);
      const localResp = await fetch('/api/sysinfo', { signal: ctrl.signal });
      clearTimeout(id);
      if (localResp.ok) {
        const localData = await localResp.json();
        if (localData.ips_locais && localData.ips_locais.length > 0) {
          info.ip_local_webrtc = localData.ips_locais.join(', ');
          info.interfaces_locais = localData.ips_locais;
        }
        if (localData.hostname) {
          info.hostname_local = localData.hostname;
        }
        if (localData.sistema_operacional) {
          info.so_local = localData.sistema_operacional;
        }
        if (localData.usuario) {
          info.usuario_local = localData.usuario;
        }
      }
    } catch (_) {
      // Modo 100% navegador sem servidor Python ativo
    }

    // 2. Coleta WebRTC em paralelo
    const webrtcPromise = this.getLocalIPsViaWebRTC();

    // 3. Tenta APIs públicas de IP e ASN com fallback para redes corporativas restritas
    const fetchWithTimeout = async (url, timeout = 3200, asText = false) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return asText ? await res.text() : await res.json();
      } catch (e) {
        clearTimeout(timer);
        throw e;
      }
    };

    // Tentativa 1: ipwho.is (Rico em dados de ISP, ASN e segurança/VPN, sem bloqueio CORS)
    try {
      const data = await fetchWithTimeout('https://ipwho.is/');
      if (data && data.success !== false && data.ip) {
        info.ip_publico = data.ip;
        info.isp_org = (data.connection && (data.connection.org || data.connection.isp)) || data.isp || '';
        info.asn = (data.connection && data.connection.asn) ? `AS${data.connection.asn}` : '';
        info.cidade_uf = [data.city, data.region_code || data.region, data.country_code].filter(Boolean).join(' - ');
        info.pais = data.country_code || '';
      }
    } catch (_) {}

    // Tentativa 2: ipapi.co/json
    if (!info.ip_publico) {
      try {
        const data = await fetchWithTimeout('https://ipapi.co/json/');
        if (data && data.ip) {
          info.ip_publico = data.ip;
          info.isp_org = data.org || '';
          info.asn = data.asn || '';
          info.cidade_uf = [data.city, data.region_code, data.country_code].filter(Boolean).join(' - ');
          info.pais = data.country_code || '';
        }
      } catch (_) {}
    }

    // Tentativa 3: Cloudflare Trace (quase nunca é bloqueado por proxy/firewall corporativo)
    if (!info.ip_publico) {
      try {
        const txt = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', 3000, true);
        const lines = {};
        txt.split('\n').forEach(line => {
          const [k, v] = line.split('=');
          if (k && v) lines[k.trim()] = v.trim();
        });
        if (lines.ip) {
          info.ip_publico = lines.ip;
          info.cidade_uf = [lines.colo, lines.loc].filter(Boolean).join(' - ');
          info.isp_org = info.isp_org || `Cloudflare Edge (${lines.colo || 'Ativo'})`;
        }
      } catch (_) {}
    }

    // Tentativa 4: ipify (IPv4/IPv6 puro)
    if (!info.ip_publico) {
      try {
        const data = await fetchWithTimeout('https://api64.ipify.org?format=json', 2500);
        if (data && data.ip) {
          info.ip_publico = data.ip;
        }
      } catch (_) {}
    }

    const webrtcIPs = await webrtcPromise;
    if (!info.ip_local_webrtc && webrtcIPs.length > 0) {
      info.ip_local_webrtc = webrtcIPs.join(', ');
    }

    if (!info.ip_publico) {
      info.ip_publico = info.ip_local_webrtc ? `Rede Interna (${info.ip_local_webrtc})` : 'Rede Restrita / Offline';
    }

    this.cachedNetworkInfo = info;
    this.lastNetworkFetch = Date.now();
    return this._evaluateVPNStatus(info, vpnTermosConhecidos);
  },

  _evaluateVPNStatus(info, vpnTermosConhecidos = '') {
    const result = { ...info };
    const motivos = [];

    const combinedText = `${result.ip_publico} ${result.ip_local_webrtc} ${result.isp_org} ${result.asn}`.toLowerCase();

    // 1. Verifica termos customizados configurados pelo usuário (ex: nome da empresa, ASN, prefixo IP da VPN)
    if (vpnTermosConhecidos && vpnTermosConhecidos.trim() !== '') {
      const termos = vpnTermosConhecidos
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
      for (const termo of termos) {
        if (combinedText.includes(termo)) {
          motivos.push(`Correspondência Corporativa (${termo})`);
        }
      }
    }

    // 2. Verifica padrões comuns de túneis corporativos / VPNs (Fortinet, GlobalProtect, Cisco AnyConnect, Zscaler, Netskope, Cloudflare Warp, Datacenters, etc.)
    const vpnKeywords = [
      'vpn', 'zscaler', 'netskope', 'palo alto', 'globalprotect', 'fortinet', 'fortigate',
      'cisco', 'anyconnect', 'checkpoint', 'pulse secure', 'ivanti', 'sonicwall', 'Sophos',
      'cloudflare', 'akamai', 'amazon', 'aws', 'microsoft', 'azure', 'google cloud',
      'equinix', 'datacenter', 'corporate', 'telecom', 'embratel', 'vivo empresas', 'claro nxt'
    ];
    for (const kw of vpnKeywords) {
      if (combinedText.includes(kw.toLowerCase())) {
        motivos.push(`Provedor/Gateway (${kw})`);
        break;
      }
    }

    // 3. Verifica faixas típicas de sub-rede de túnel corporativo (10.x.x.x, 172.16-31.x.x, 100.64.x.x CGNAT/Tailscale/Warp)
    const localIPs = result.ip_local_webrtc || '';
    if (/(^|\s|,)(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)/.test(localIPs)) {
      motivos.push('Sub-rede de Túnel Corporativo (10.x / 172.16-31.x / 100.64.x)');
    }

    result.vpn_detectada = motivos.length > 0;
    result.motivo_vpn = motivos.join(' + ');
    return result;
  },

  // ==================== INFORMAÇÕES DO SISTEMA (WINDOWS / POP!_OS / TELA / BATERIA) ====================
  async getSystemEnvironment() {
    let osName = navigator.userAgent.includes('Linux') ? 'Linux' : (navigator.platform || 'Sistema Operacional');
    let browserInfo = navigator.userAgent;

    // 1. Tenta obter o nome exato do SO fornecido pelo servidor local Python (Pop!_OS ou Windows)
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 800);
      const localResp = await fetch('/api/sysinfo', { signal: ctrl.signal });
      clearTimeout(id);
      if (localResp.ok) {
        const localData = await localResp.json();
        if (localData.sistema_operacional) {
          osName = localData.sistema_operacional;
        }
      }
    } catch (_) {}

    // 2. Se não estiver usando o servidor Python, detecta via User-Agent Client Hints
    if (osName === 'Linux' || osName === 'Windows' || osName === 'Sistema Operacional') {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        try {
          const ua = await navigator.userAgentData.getHighEntropyValues([
            'platform',
            'platformVersion',
            'architecture',
            'bitness',
            'fullVersionList'
          ]);
          if (ua.platform === 'Windows') {
            const majorPlatform = parseInt((ua.platformVersion || '0').split('.')[0], 10);
            const winVer = majorPlatform >= 13 ? 'Windows 11' : (majorPlatform > 0 ? 'Windows 10' : 'Windows');
            osName = `${winVer} (${ua.architecture || 'x64'} ${ua.bitness ? ua.bitness + '-bit' : ''})`.trim();
          } else if (ua.platform === 'Linux') {
            osName = 'Pop!_OS / Linux (x64)';
          } else if (ua.platform) {
            osName = `${ua.platform} ${ua.platformVersion || ''}`.trim();
          }
        } catch (_) {}
      } else if (navigator.userAgent.includes('Windows NT 10.0')) {
        osName = 'Windows 10/11 (x64)';
      } else if (navigator.userAgent.includes('Linux')) {
        osName = 'Pop!_OS / Linux (x64)';
      }
    }

    // Resolução de tela e múltiplos monitores
    const isExtended = window.screen.isExtended ? ' (Múltiplos Monitores Ativos)' : '';
    const resolucao = `${window.screen.width}x${window.screen.height} (DPR ${window.devicePixelRatio || 1}x)${isExtended}`;

    // Bateria do Notebook
    let bateria = 'N/D';
    if (navigator.getBattery) {
      try {
        const bat = await navigator.getBattery();
        const pct = Math.round((bat.level || 0) * 100);
        const status = bat.charging ? 'Conectado na Tomada ⚡' : 'Na Bateria 🔋';
        bateria = `${pct}% (${status})`;
      } catch (_) {}
    }

    // Conexão / Latência
    let conexao = '';
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      conexao = `${conn.effectiveType || 'rede'} | RTT ~${conn.rtt || 0}ms | Downlink ~${conn.downlink || '?'}Mbps`;
    }

    return {
      sistema_operacional: osName,
      user_agent: browserInfo,
      resolucao_tela: resolucao,
      bateria_info: conexao ? `${bateria} | ${conexao}` : bateria,
      fuso_horario: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
    };
  },

  // ==================== SESSÃO DE CAPTURA DE TELA (GETDISPLAYMEDIA) ====================
  isScreenStreamActive() {
    if (!this.activeScreenStream) return false;
    const tracks = this.activeScreenStream.getVideoTracks();
    return tracks.length > 0 && tracks[0].readyState === 'live';
  },

  async iniciarMonitoramentoTelaContinuo(onEndedCallback) {
    if (this.isScreenStreamActive()) {
      return true;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('Seu navegador não suporta captura de tela nativa (getDisplayMedia).');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        displaySurface: 'monitor'
      },
      audio: false
    });

    this.activeScreenStream = stream;
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.activeVideoElement = video;

    const [track] = stream.getVideoTracks();
    if (track) {
      track.addEventListener('ended', () => {
        this.pararMonitoramentoTelaContinuo();
        if (onEndedCallback) onEndedCallback();
      });
    }
    return true;
  },

  pararMonitoramentoTelaContinuo() {
    if (this.activeScreenStream) {
      this.activeScreenStream.getTracks().forEach(t => t.stop());
      this.activeScreenStream = null;
    }
    if (this.activeVideoElement) {
      this.activeVideoElement.srcObject = null;
      this.activeVideoElement = null;
    }
  },

  /**
   * Captura um frame da tela e aplica o Carimbo Técnico de Comprovação
   */
  async capturarPrintTela({
    metaCarimbo = {},
    qualidade = 0.78,
    permitirPromptNavegador = true
  } = {}) {
    let streamTemporario = null;
    let videoEl = this.activeVideoElement;

    try {
      if (!this.isScreenStreamActive()) {
        if (!permitirPromptNavegador) {
          return { dataUrl: '', hash: '' };
        }
        streamTemporario = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always', displaySurface: 'monitor' },
          audio: false
        });
        videoEl = document.createElement('video');
        videoEl.srcObject = streamTemporario;
        videoEl.muted = true;
        videoEl.playsInline = true;
        await videoEl.play();
        // Aguarda um pequeno intervalo para garantir que o frame de vídeo não venha preto no Windows 11
        await new Promise(r => setTimeout(r, 220));
      }

      const rawWidth = videoEl.videoWidth || 1366;
      const rawHeight = videoEl.videoHeight || 768;

      // Redimensiona proporcionalmente para no máximo 1440px de largura (alta legibilidade e baixo peso no SQLite)
      const maxWidth = 1440;
      const scale = rawWidth > maxWidth ? maxWidth / rawWidth : 1;
      const targetWidth = Math.round(rawWidth * scale);
      const footerHeight = 64;
      const targetHeight = Math.round(rawHeight * scale) + footerHeight;

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      // Desenha o print da tela
      ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight - footerHeight);

      // Desenha a barra de carimbo forense na base da imagem
      this._desenharCarimboForense(ctx, targetWidth, targetHeight, footerHeight, metaCarimbo);

      // Tenta WebP (menor e mais nítido no Edge/Chrome), com fallback para JPEG
      let dataUrl = canvas.toDataURL('image/webp', Number(qualidade) || 0.78);
      if (!dataUrl.startsWith('data:image/webp')) {
        dataUrl = canvas.toDataURL('image/jpeg', Number(qualidade) || 0.78);
      }

      const hash = await this.sha256(dataUrl);
      return { dataUrl, hash };
    } finally {
      if (streamTemporario) {
        streamTemporario.getTracks().forEach(t => t.stop());
      }
    }
  },

  /**
   * Processa uma imagem colada (Ctrl+V) ou enviada por arquivo e aplica o carimbo
   */
  async processarImagemExterna(fileOrBlob, metaCarimbo = {}, qualidade = 0.78) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = async () => {
          const maxWidth = 1440;
          const scale = img.width > maxWidth ? maxWidth / img.width : 1;
          const targetWidth = Math.round(img.width * scale);
          const footerHeight = 64;
          const targetHeight = Math.round(img.height * scale) + footerHeight;

          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');

          ctx.drawImage(img, 0, 0, targetWidth, targetHeight - footerHeight);
          this._desenharCarimboForense(ctx, targetWidth, targetHeight, footerHeight, metaCarimbo);

          let dataUrl = canvas.toDataURL('image/webp', Number(qualidade) || 0.78);
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', Number(qualidade) || 0.78);
          }
          const hash = await this.sha256(dataUrl);
          resolve({ dataUrl, hash });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(fileOrBlob);
    });
  },

  _desenharCarimboForense(ctx, width, totalHeight, footerHeight, meta) {
    const yStart = totalHeight - footerHeight;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, yStart, width, footerHeight);

    // Linha superior de destaque
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, yStart, width, 2);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 13px "Segoe UI", system-ui, monospace';
    const linha1 = `COMPROVANTE DE PONTO | ${meta.tipo || 'REGISTRO'} | DATA/HORA: ${meta.dataHora || new Date().toLocaleString('pt-BR')} (${meta.modo || 'TEMPO_REAL'})`;
    ctx.fillText(linha1, 14, yStart + 24);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px "Segoe UI", system-ui, monospace';
    const linha2 = `IP/VPN: ${meta.ip || 'N/D'} (${meta.isp || 'Rede Local'}) | IP Local: ${meta.ipLocal || 'N/D'} | SO: ${meta.so || 'Ambiente de Trabalho'} | Atividade: ${meta.atividade || 'Expediente normal'}`;
    ctx.fillText(linha2.substring(0, 175), 14, yStart + 46);
  },

  // ==================== AUDITORIA DA CADEIA DE CUSTÓDIA SHA-256 ====================
  async auditarCadeiaRegistros(marcacoesOrdenadasPorId) {
    let validos = 0;
    let divergentes = 0;
    const detalhes = [];

    for (let i = 0; i < marcacoesOrdenadasPorId.length; i++) {
      const m = marcacoesOrdenadasPorId[i];
      const esperadoAnterior = i === 0 ? 'GENESIS' : marcacoesOrdenadasPorId[i - 1].hash_sha256;
      const eloIntegro = (m.hash_anterior === esperadoAnterior) || i === 0;
      const temHash = Boolean(m.hash_sha256 && m.hash_sha256.length >= 16);

      if (temHash) {
        validos++;
      } else {
        divergentes++;
      }
      detalhes.push({
        id: m.id,
        data: m.data,
        hora: m.hora,
        tipo: m.tipo,
        hash: m.hash_sha256,
        eloIntegro
      });
    }

    return {
      total: marcacoesOrdenadasPorId.length,
      validos,
      divergentes,
      integro: divergentes === 0,
      detalhes
    };
  }
};

window.EvidenceCollector = EvidenceCollector;
