/**
 * Controlador Principal da Interface (Seu Ponto - Sistema de Marcação, Banco de Horas & Comprovação Forense)
 */

const App = {
  db: null,
  config: {},
  netInfo: null,
  sysInfo: null,
  timerInterval: null,
  dataFiltroDiario: '',
  dataFiltroSemanal: '',
  mesFiltroMensal: '',
  pastedScreenshotModal: null, // { dataUrl, hash } para o modal de ajuste/inclusão

  async init() {
    try {
      this.db = new window.PontoDatabase();
      this.db.onSyncStatusChange = status => this.atualizarBadgeArquivoSQLite(status);
      await this.db.init();
      this.config = this.db.getConfigAll();

      const hoje = window.PontoCalculations.hojeStr();
      this.dataFiltroDiario = hoje;
      this.dataFiltroSemanal = hoje;
      this.mesFiltroMensal = hoje.substring(0, 7);

      this.configurarEventosUI();
      this.iniciarRelogioTempoReal();

      // Coleta telemetria do sistema e rede em paralelo sem travar a inicialização
      this.atualizarTelemetriaAmbiente(false);

      this.renderizarTudo();
      this.toast('Banco SQLite carregado com sucesso.', 'success');
    } catch (err) {
      console.error('Erro ao inicializar aplicação:', err);
      this.toast(`Erro ao iniciar: ${err.message}`, 'danger');
    }
  },

  // ==================== TELEMETRIA (IP / VPN / SISTEMA / TELA) ====================
  async atualizarTelemetriaAmbiente(forceRefresh = true) {
    const badgeIP = document.getElementById('badge-ip-status');
    const badgeVPN = document.getElementById('badge-vpn-status');
    if (badgeIP) badgeIP.innerHTML = `<span class="dot pulse"></span> Consultando IP/VPN...`;

    this.sysInfo = await window.EvidenceCollector.getSystemEnvironment();
    this.netInfo = await window.EvidenceCollector.getNetworkAndVPNInfo(
      this.config.vpn_termos_conhecidos || '',
      forceRefresh
    );

    if (badgeIP) {
      const ipTxt = this.netInfo.ip_publico || 'Local';
      const orgTxt = this.netInfo.isp_org ? ` (${this.netInfo.isp_org.substring(0, 24)})` : '';
      badgeIP.innerHTML = `<span class="dot"></span> IP: ${this.escapeHtml(ipTxt)}${this.escapeHtml(orgTxt)}`;
    }

    if (badgeVPN) {
      if (this.netInfo.vpn_detectada) {
        badgeVPN.className = 'pill-badge success';
        badgeVPN.title = this.netInfo.motivo_vpn || 'Rede Corporativa / VPN Identificada';
        badgeVPN.innerHTML = `<span class="dot"></span> VPN / Rede Corp Ativa`;
      } else {
        badgeVPN.className = 'pill-badge warning';
        badgeVPN.title = 'Dica: você pode cadastrar o ASN/IP da VPN da empresa nas Configurações';
        badgeVPN.innerHTML = `<span class="dot"></span> Rede Padrão / Direta`;
      }
    }

    this.renderizarCardEvidenciaAoVivo();
  },

  renderizarCardEvidenciaAoVivo() {
    const el = document.getElementById('live-telemetry-details');
    if (!el) return;
    const net = this.netInfo || {};
    const sys = this.sysInfo || {};
    const streamAtivo = window.EvidenceCollector.isScreenStreamActive();

    el.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:10px; font-size:0.82rem;">
        <div style="background:var(--bg-input); padding:10px; border-radius:8px; border:1px solid var(--border-color);">
          <div style="color:var(--text-secondary); font-size:0.74rem;">IP DE SAÍDA (VPN / INTERNET)</div>
          <div style="font-weight:700; color:var(--primary); margin-top:2px;">${this.escapeHtml(net.ip_publico || 'Verificando...')}</div>
          <div style="color:var(--text-secondary); font-size:0.74rem;">${this.escapeHtml(net.isp_org || 'Provedor não informado')} ${this.escapeHtml(net.asn || '')}</div>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px; border:1px solid var(--border-color);">
          <div style="color:var(--text-secondary); font-size:0.74rem;">IP LOCAL / INTERFACE TÚNEL</div>
          <div style="font-weight:700; margin-top:2px;">${this.escapeHtml(net.ip_local_webrtc || 'Protegido pelo navegador (mDNS)')}</div>
          <div style="color:var(--text-secondary); font-size:0.74rem;">Local: ${this.escapeHtml(net.cidade_uf || sys.fuso_horario || 'Brasil')}</div>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px; border:1px solid var(--border-color);">
          <div style="color:var(--text-secondary); font-size:0.74rem;">SISTEMA & MONITORES</div>
          <div style="font-weight:700; margin-top:2px;">${this.escapeHtml(sys.sistema_operacional || 'Windows 11')}</div>
          <div style="color:var(--text-secondary); font-size:0.74rem;">Tela: ${this.escapeHtml(sys.resolucao_tela || '')}</div>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px; border:1px solid var(--border-color);">
          <div style="color:var(--text-secondary); font-size:0.74rem;">CAPTURA DE TELA (COMPROVAÇÃO)</div>
          <div style="font-weight:700; margin-top:2px; color:${streamAtivo ? '#34d399' : '#fbbf24'};">
            ${streamAtivo ? '🟢 Sessão 1-Clique Ativa (Sem Popup)' : '📸 Captura ao Bater Ponto'}
          </div>
          <div style="color:var(--text-secondary); font-size:0.74rem;">${this.escapeHtml(sys.bateria_info || '')}</div>
        </div>
      </div>
    `;

    const btnStream = document.getElementById('btn-toggle-screen-stream');
    if (btnStream) {
      if (streamAtivo) {
        btnStream.className = 'btn btn-danger btn-sm';
        btnStream.innerHTML = '⏹️ Desativar Compartilhamento Contínuo de Tela';
      } else {
        btnStream.className = 'btn btn-primary btn-sm';
        btnStream.innerHTML = '🖥️ Ativar Print Instantâneo (1-Clique sem repetir permissão)';
      }
    }
  },

  atualizarBadgeArquivoSQLite(status) {
    const badge = document.getElementById('badge-sqlite-status');
    if (!badge) return;
    if (status && status.connected && status.fileName) {
      badge.className = 'pill-badge success';
      badge.innerHTML = `<span class="dot"></span> SQLite Sincronizado: ${this.escapeHtml(status.fileName)}`;
    } else {
      badge.className = 'pill-badge primary';
      badge.innerHTML = `<span class="dot"></span> SQLite Ativo (Navegador)`;
    }
  },

  // ==================== RELÓGIO EM TEMPO REAL ====================
  iniciarRelogioTempoReal() {
    const tick = () => {
      const agora = new Date();
      const hojeStr = window.PontoCalculations.dateToYMD(agora);
      const elTime = document.getElementById('live-clock-time');
      const elDate = document.getElementById('live-clock-date');

      if (elTime) {
        elTime.textContent = agora.toLocaleTimeString('pt-BR', { hour12: false });
      }
      if (elDate) {
        const nomeDia = window.PontoCalculations.getNomeDiaSemana(hojeStr);
        elDate.textContent = `${nomeDia}, ${window.PontoCalculations.formatarDataBR(hojeStr)}`;
      }

      // Atualiza os contadores vivos do dia de hoje
      this.atualizarContadoresAoVivoHoje(agora);
    };

    tick();
    this.timerInterval = setInterval(tick, 1000);
  },

  atualizarContadoresAoVivoHoje(agoraDate) {
    const hojeStr = window.PontoCalculations.dateToYMD(agoraDate);
    const marcacoesHoje = this.db.getMarcacoesPorData(hojeStr);
    const diaEspHoje = this.db.getDiaEspecial(hojeStr);
    const resumoHoje = window.PontoCalculations.calcularResumoDia(
      hojeStr,
      marcacoesHoje,
      this.config,
      diaEspHoje,
      agoraDate
    );

    const elTrab = document.getElementById('live-worked-today');
    const elAlmoco = document.getElementById('live-lunch-today');
    const elSaldoHoje = document.getElementById('live-balance-today');
    const elStatusTurno = document.getElementById('live-shift-status');
    const elSaidaPrevista = document.getElementById('live-predicted-exit');
    const elProgressHoje = document.getElementById('live-progress-bar-today');

    if (elTrab) {
      elTrab.textContent = window.PontoCalculations.formatarDuracaoSegundos(resumoHoje.segundosTrabalhados, false);
    }
    if (elAlmoco) {
      elAlmoco.textContent = window.PontoCalculations.formatarDuracaoSegundos(resumoHoje.segundosAlmoco, false);
    }
    if (elSaldoHoje) {
      elSaldoHoje.textContent = resumoHoje.contabilizarNoBanco
        ? window.PontoCalculations.formatarDuracaoSegundos(resumoHoje.saldoSegundos, true)
        : '00h 00m 00s';
      elSaldoHoje.style.color = resumoHoje.saldoSegundos >= 0 ? 'var(--success)' : 'var(--warning)';
    }
    if (elStatusTurno) {
      if (resumoHoje.emAndamento) {
        elStatusTurno.innerHTML = `<span class="pill-badge success"><span class="dot pulse"></span> Trabalhando Agora</span>`;
      } else if (resumoHoje.emAlmoco) {
        elStatusTurno.innerHTML = `<span class="pill-badge warning"><span class="dot pulse"></span> Em Horário de Almoço / Pausa</span>`;
      } else if (resumoHoje.temMarcacao) {
        elStatusTurno.innerHTML = `<span class="pill-badge primary">Expediente Pausado / Concluído</span>`;
      } else {
        elStatusTurno.innerHTML = `<span class="pill-badge">Aguardando 1ª Entrada do Dia</span>`;
      }
    }
    if (elSaidaPrevista) {
      const metaH = window.PontoCalculations.formatarDuracaoMinutos(resumoHoje.metaMinutos);
      if (resumoHoje.previsaoSaidaMeta) {
        elSaidaPrevista.innerHTML = `Meta hoje: <strong>${metaH}</strong> &bull; Saída p/ meta: <strong style="color:var(--primary)">${resumoHoje.previsaoSaidaMeta}</strong> (p/ 8h: ${resumoHoje.previsaoSaida8h || '--:--'} | p/ 9h: ${resumoHoje.previsaoSaida9h || '--:--'})`;
      } else {
        elSaidaPrevista.innerHTML = `Meta prevista para hoje (${resumoHoje.nomeDia}): <strong>${metaH}</strong>`;
      }
    }
    if (elProgressHoje) {
      const pct = resumoHoje.metaMinutos > 0
        ? Math.min(100, Math.round((resumoHoje.minutosTrabalhados / resumoHoje.metaMinutos) * 100))
        : (resumoHoje.minutosTrabalhados > 0 ? 100 : 0);
      elProgressHoje.style.width = `${pct}%`;
    }

    // Destaca o próximo botão de batida recomendado
    document.querySelectorAll('.btn-punch').forEach(btn => {
      const tipo = btn.getAttribute('data-punch-type');
      if (tipo === resumoHoje.proximaBatidaSugerida) {
        btn.classList.add('recommended');
      } else {
        btn.classList.remove('recommended');
      }
    });
  },

  // ==================== BATER PONTO EM TEMPO REAL ====================
  async baterPontoTempoReal(tipoBatida) {
    const agora = new Date();
    const dataStr = window.PontoCalculations.dateToYMD(agora);
    const horaStr = agora.toLocaleTimeString('pt-BR', { hour12: false });
    const inputAtividade = document.getElementById('input-live-activity');
    const chkCapturarPrint = document.getElementById('chk-live-screenshot');

    const atividade = inputAtividade ? inputAtividade.value.trim() : '';
    const deveCapturarPrint = chkCapturarPrint ? chkCapturarPrint.checked : true;

    try {
      this.toast(`Registrando ${this.labelTipoBatida(tipoBatida)} às ${horaStr}...`, 'primary');

      // Garante dados de rede e sistema atualizados
      if (!this.netInfo) {
        await this.atualizarTelemetriaAmbiente(false);
      }

      let screenshotDataUrl = '';
      let screenshotHash = '';

      if (deveCapturarPrint) {
        try {
          const printRes = await window.EvidenceCollector.capturarPrintTela({
            metaCarimbo: {
              tipo: this.labelTipoBatida(tipoBatida).toUpperCase(),
              dataHora: `${window.PontoCalculations.formatarDataBR(dataStr)} ${horaStr}`,
              modo: 'TEMPO_REAL',
              ip: this.netInfo?.ip_publico || 'N/D',
              isp: this.netInfo?.isp_org || '',
              ipLocal: this.netInfo?.ip_local_webrtc || 'Local',
              so: this.sysInfo?.sistema_operacional || 'Windows 11',
              atividade: atividade || 'Registro em tempo real'
            },
            qualidade: Number(this.config.qualidade_print || 0.78),
            permitirPromptNavegador: true
          });
          screenshotDataUrl = printRes.dataUrl;
          screenshotHash = printRes.hash;
        } catch (printErr) {
          console.warn('Captura de tela cancelada ou indisponível:', printErr);
          this.toast('Aviso: Ponto será salvo sem print da tela (permissão negada/cancelada).', 'warning');
        }
      }

      await this.db.inserirMarcacao({
        data: dataStr,
        hora: horaStr,
        timestamp_iso: agora.toISOString(),
        tipo: tipoBatida,
        modo_registro: 'TEMPO_REAL',
        justificativa: '',
        atividade_atual: atividade,
        ip_publico: this.netInfo?.ip_publico || 'Não identificado',
        ip_local_webrtc: this.netInfo?.ip_local_webrtc || '',
        isp_org: this.netInfo?.isp_org || '',
        asn: this.netInfo?.asn || '',
        cidade_uf: this.netInfo?.cidade_uf || '',
        vpn_detectada: this.netInfo?.vpn_detectada ? 1 : 0,
        user_agent: this.sysInfo?.user_agent || navigator.userAgent,
        sistema_operacional: this.sysInfo?.sistema_operacional || 'Windows 11',
        resolucao_tela: this.sysInfo?.resolucao_tela || '',
        bateria_info: this.sysInfo?.bateria_info || '',
        fuso_horario: this.sysInfo?.fuso_horario || '',
        screenshot_dataurl: screenshotDataUrl,
        screenshot_hash: screenshotHash
      });

      if (inputAtividade) inputAtividade.value = '';
      this.renderizarTudo();
      this.toast(`Ponto (${this.labelTipoBatida(tipoBatida)}) registrado às ${horaStr} com comprovação!`, 'success');
    } catch (err) {
      console.error(err);
      this.toast(`Erro ao registrar ponto: ${err.message}`, 'danger');
    }
  },

  // ==================== MODAL DE AJUSTE / PONTO RETROATIVO ====================
  abrirModalAjuste(marcacaoId = null, dataPreSelecionada = null) {
    const modal = document.getElementById('modal-ajuste-ponto');
    const title = document.getElementById('modal-ajuste-title');
    const idInput = document.getElementById('ajuste-id');
    const dataInput = document.getElementById('ajuste-data');
    const horaInput = document.getElementById('ajuste-hora');
    const tipoInput = document.getElementById('ajuste-tipo');
    const ativInput = document.getElementById('ajuste-atividade');
    const justInput = document.getElementById('ajuste-justificativa');
    const previewBox = document.getElementById('ajuste-screenshot-preview');

    this.pastedScreenshotModal = null;

    if (marcacaoId) {
      const m = this.db.getMarcacaoById(marcacaoId);
      if (!m) return;
      title.textContent = `Editar / Ajustar Marcação #${m.id}`;
      idInput.value = m.id;
      dataInput.value = m.data;
      horaInput.value = m.hora.substring(0, 5);
      tipoInput.value = m.tipo;
      ativInput.value = m.atividade_atual || '';
      justInput.value = m.justificativa || '';
      if (m.screenshot_dataurl) {
        this.pastedScreenshotModal = { dataUrl: m.screenshot_dataurl, hash: m.screenshot_hash };
        previewBox.innerHTML = `<img src="${m.screenshot_dataurl}" style="max-height:130px; border-radius:6px; border:1px solid var(--border-highlight);" />`;
      } else {
        previewBox.innerHTML = `<span style="color:var(--text-secondary); font-size:0.8rem;">Nenhum print anexado. Pressione <strong>Ctrl+V</strong> para colar um print ou selecione um arquivo.</span>`;
      }
    } else {
      title.textContent = 'Lançar Ponto Esquecido / Ajuste Manual';
      idInput.value = '';
      dataInput.value = dataPreSelecionada || this.dataFiltroDiario || window.PontoCalculations.hojeStr();
      horaInput.value = '08:00';
      tipoInput.value = 'ENTRADA';
      ativInput.value = '';
      justInput.value = 'Esquecimento de marcação no momento exato';
      previewBox.innerHTML = `<span style="color:var(--text-secondary); font-size:0.8rem;">Pressione <strong>Ctrl+V</strong> aqui para colar um print da área de transferência (Win+Shift+S) ou clique em Capturar Tela Agora.</span>`;
    }

    modal.classList.add('open');
  },

  fecharModalAjuste() {
    document.getElementById('modal-ajuste-ponto')?.classList.remove('open');
  },

  async salvarModalAjuste(e) {
    e.preventDefault();
    const id = document.getElementById('ajuste-id').value;
    const data = document.getElementById('ajuste-data').value;
    let hora = document.getElementById('ajuste-hora').value;
    if (hora.length === 5) hora += ':00';
    const tipo = document.getElementById('ajuste-tipo').value;
    const atividade = document.getElementById('ajuste-atividade').value.trim();
    const justificativa = document.getElementById('ajuste-justificativa').value.trim();

    if (!data || !hora) {
      this.toast('Preencha a data e o horário.', 'warning');
      return;
    }

    if (!this.netInfo) {
      await this.atualizarTelemetriaAmbiente(false);
    }

    if (id) {
      await this.db.atualizarMarcacao(Number(id), {
        data,
        hora,
        tipo,
        atividade_atual: atividade,
        justificativa: justificativa || 'Ajustado manualmente pelo usuário',
        screenshot_dataurl: this.pastedScreenshotModal ? this.pastedScreenshotModal.dataUrl : '',
        screenshot_hash: this.pastedScreenshotModal ? this.pastedScreenshotModal.hash : ''
      });
      this.toast('Marcação atualizada com sucesso!', 'success');
    } else {
      await this.db.inserirMarcacao({
        data,
        hora,
        timestamp_iso: new Date().toISOString(),
        tipo,
        modo_registro: 'AJUSTE_MANUAL',
        justificativa: justificativa || 'Inclusão manual retroativa',
        atividade_atual: atividade,
        ip_publico: this.netInfo?.ip_publico || 'Não identificado',
        ip_local_webrtc: this.netInfo?.ip_local_webrtc || '',
        isp_org: this.netInfo?.isp_org || '',
        asn: this.netInfo?.asn || '',
        cidade_uf: this.netInfo?.cidade_uf || '',
        vpn_detectada: this.netInfo?.vpn_detectada ? 1 : 0,
        user_agent: this.sysInfo?.user_agent || navigator.userAgent,
        sistema_operacional: this.sysInfo?.sistema_operacional || 'Windows 11',
        resolucao_tela: this.sysInfo?.resolucao_tela || '',
        bateria_info: this.sysInfo?.bateria_info || '',
        fuso_horario: this.sysInfo?.fuso_horario || '',
        screenshot_dataurl: this.pastedScreenshotModal ? this.pastedScreenshotModal.dataUrl : '',
        screenshot_hash: this.pastedScreenshotModal ? this.pastedScreenshotModal.hash : ''
      });
      this.toast('Ponto manual registrado com sucesso!', 'success');
    }

    this.fecharModalAjuste();
    this.renderizarTudo();
  },

  async excluirRegistroPonto(id) {
    if (!confirm('Deseja realmente excluir esta marcação de ponto?')) return;
    await this.db.excluirMarcacao(id);
    this.renderizarTudo();
    this.toast('Marcação removida.', 'warning');
  },

  // ==================== VISUALIZADOR DE EVIDÊNCIA / DETALHES ====================
  abrirModalEvidencia(id) {
    const m = this.db.getMarcacaoById(id);
    if (!m) return;
    const modal = document.getElementById('modal-evidencia-detalhe');
    const body = document.getElementById('modal-evidencia-body');

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <div>
          <span class="pill-badge ${m.modo_registro === 'TEMPO_REAL' ? 'success' : 'warning'}">
            ${m.modo_registro === 'TEMPO_REAL' ? '⚡ Marcação em Tempo Real' : '✏️ Ajuste Manual / Retroativo'}
          </span>
          <span class="pill-badge primary" style="margin-left:6px;">${this.labelTipoBatida(m.tipo)}</span>
        </div>
        <div style="font-size:0.9rem; font-weight:700;">
          ${window.PontoCalculations.formatarDataBR(m.data)} às ${this.escapeHtml(m.hora)}
        </div>
      </div>

      ${m.screenshot_dataurl ? `
        <div style="margin-bottom:16px; text-align:center; background:#000; padding:8px; border-radius:8px; border:1px solid var(--border-highlight);">
          <img src="${m.screenshot_dataurl}" style="max-width:100%; max-height:460px; border-radius:4px;" />
          <div style="margin-top:8px;">
            <a href="${m.screenshot_dataurl}" download="comprovante_${m.data}_${m.hora.replace(/:/g, '-')}_${m.tipo}.webp" class="btn btn-sm btn-primary">
              ⬇️ Baixar Imagem Comprobatória
            </a>
          </div>
        </div>
      ` : `
        <div style="padding:18px; background:var(--bg-input); border-radius:8px; text-align:center; color:var(--text-secondary); margin-bottom:16px;">
          Nenhuma captura de tela anexada neste registro.
        </div>
      `}

      <div class="form-row" style="font-size:0.83rem; gap:10px;">
        <div style="background:var(--bg-input); padding:10px; border-radius:8px;">
          <strong style="color:var(--text-secondary); display:block;">IP PÚBLICO / SAÍDA VPN</strong>
          <span>${this.escapeHtml(m.ip_publico || 'N/D')} ${m.vpn_detectada ? '✅ (VPN/Corp)' : ''}</span>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px;">
          <strong style="color:var(--text-secondary); display:block;">PROVEDOR / ASN / LOCAL</strong>
          <span>${this.escapeHtml(m.isp_org || 'N/D')} ${this.escapeHtml(m.asn || '')} - ${this.escapeHtml(m.cidade_uf || '')}</span>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px;">
          <strong style="color:var(--text-secondary); display:block;">IP LOCAL / INTERFACE</strong>
          <span>${this.escapeHtml(m.ip_local_webrtc || 'N/D')}</span>
        </div>
        <div style="background:var(--bg-input); padding:10px; border-radius:8px;">
          <strong style="color:var(--text-secondary); display:block;">SISTEMA & TELA</strong>
          <span>${this.escapeHtml(m.sistema_operacional || '')} | ${this.escapeHtml(m.resolucao_tela || '')}</span>
        </div>
      </div>

      <div style="margin-top:12px; background:var(--bg-input); padding:12px; border-radius:8px; font-size:0.82rem;">
        <div><strong>Atividade Registrada:</strong> ${this.escapeHtml(m.atividade_atual || 'Não informada')}</div>
        ${m.justificativa ? `<div style="margin-top:4px; color:#fbbf24;"><strong>Justificativa / Nota:</strong> ${this.escapeHtml(m.justificativa)}</div>` : ''}
        <div style="margin-top:6px; color:var(--text-secondary);"><strong>Timestamp de Criação (ISO):</strong> ${this.escapeHtml(m.criado_em)}</div>
        <div style="margin-top:6px;">
          <strong>Assinatura SHA-256 do Registro:</strong>
          <div class="hash-code" style="margin-top:3px;">${this.escapeHtml(m.hash_sha256 || '')}</div>
        </div>
        <div style="margin-top:6px;">
          <strong>Elo Anterior (Cadeia de Custódia):</strong>
          <div class="hash-code" style="margin-top:3px;">${this.escapeHtml(m.hash_anterior || 'GENESIS')}</div>
        </div>
      </div>
    `;

    modal.classList.add('open');
  },

  // ==================== RENDERIZAÇÃO GERAL ====================
  renderizarTudo() {
    this.config = this.db.getConfigAll();
    const todasMarcacoes = this.db.getTodasMarcacoes();
    const diasEspeciaisMap = this.db.getTodosDiasEspeciais();
    const agora = new Date();
    const hojeStr = window.PontoCalculations.dateToYMD(agora);

    // 1. Banco de Horas Global & Sextas
    const bancoGlobal = window.PontoCalculations.calcularBancoDeHorasGlobal(
      todasMarcacoes,
      diasEspeciaisMap,
      this.config,
      agora
    );

    // 2. Resumo da Semana Atual
    const semanaAtual = window.PontoCalculations.calcularResumoSemana(
      hojeStr,
      todasMarcacoes,
      diasEspeciaisMap,
      this.config,
      agora
    );

    // 3. Atualiza KPIs do Topo
    this.renderizarKPIsTopo(bancoGlobal, semanaAtual, hojeStr, todasMarcacoes, diasEspeciaisMap, agora);

    // 4. Atualiza Aba 1 (Painel & Hoje)
    this.renderizarAbaHoje(hojeStr, todasMarcacoes, diasEspeciaisMap, semanaAtual, bancoGlobal, agora);

    // 5. Atualiza Aba 2 (Resumo Diário & Ajustes)
    this.renderizarAbaDiario(todasMarcacoes, diasEspeciaisMap, agora);

    // 6. Atualiza Aba 3 (Resumo Semanal & Sextas-Feiras)
    this.renderizarAbaSemanal(todasMarcacoes, diasEspeciaisMap, bancoGlobal, agora);

    // 7. Atualiza Aba 4 (Resumo Mensal)
    this.renderizarAbaMensal(todasMarcacoes, diasEspeciaisMap, bancoGlobal, agora);

    // 8. Atualiza Aba 5 (Galeria de Evidências & Relatório de Auditoria)
    this.renderizarAbaEvidencias(todasMarcacoes);

    // 9. Atualiza Aba 6 (SQLite & Configurações)
    this.renderizarAbaConfigSQLite();
  },

  renderizarKPIsTopo(bancoGlobal, semanaAtual, hojeStr, todasMarcacoes, diasEspeciaisMap, agora) {
    const kpiSaldoBanco = document.getElementById('kpi-saldo-banco');
    const kpiSaldoBancoSub = document.getElementById('kpi-saldo-banco-sub');
    const kpiCardBanco = document.getElementById('kpi-card-banco');

    const saldoMin = bancoGlobal.saldoAcumuladoMin;
    if (kpiSaldoBanco) {
      kpiSaldoBanco.textContent = window.PontoCalculations.formatarDuracaoMinutos(saldoMin, true);
      kpiSaldoBanco.style.color = saldoMin >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    if (kpiCardBanco) {
      kpiCardBanco.className = `kpi-card ${saldoMin >= 0 ? 'kpi-positive' : 'kpi-negative'}`;
    }
    if (kpiSaldoBancoSub) {
      if (saldoMin >= 0) {
        kpiSaldoBancoSub.textContent = `Você tem horas sobrando (crédito acumulado)`;
      } else {
        kpiSaldoBancoSub.textContent = `Horas pendentes de compensação`;
      }
    }

    // KPI Sextas de Folga Disponíveis
    const kpiSextasDisp = document.getElementById('kpi-sextas-livres');
    const kpiSextasSub = document.getElementById('kpi-sextas-livres-sub');
    if (kpiSextasDisp) {
      const qtdSextas4h = bancoGlobal.sextasLivresDisponiveis;
      const qtdDias8h = bancoGlobal.diasInteiros8hDisponiveis;
      if (saldoMin >= 240) {
        kpiSextasDisp.textContent = `${qtdSextas4h} sexta(s)`;
        kpiSextasDisp.style.color = '#c084fc';
        kpiSextasSub.textContent = `Cobre ${qtdSextas4h} sexta(s) de 4h (ou ${qtdDias8h} dia(s) de 8h)`;
      } else if (saldoMin > 0) {
        const faltaParaSexta = 240 - saldoMin;
        kpiSextasDisp.textContent = `${window.PontoCalculations.formatarDuracaoMinutos(saldoMin)} acum.`;
        kpiSextasDisp.style.color = 'var(--primary)';
        kpiSextasSub.textContent = `Faltam ${window.PontoCalculations.formatarDuracaoMinutos(faltaParaSexta)} p/ 1 sexta livre inteira (4h)`;
      } else {
        kpiSextasDisp.textContent = `0 sextas`;
        kpiSextasDisp.style.color = 'var(--text-secondary)';
        kpiSextasSub.textContent = `Acumule +4h no banco para liberar 1 sexta-feira`;
      }
    }

    // KPI Semana Atual (40h)
    const kpiSemanaTrab = document.getElementById('kpi-semana-trabalhado');
    const kpiSemanaSub = document.getElementById('kpi-semana-sub');
    if (kpiSemanaTrab) {
      const trabSem = window.PontoCalculations.formatarDuracaoMinutos(semanaAtual.minutosTrabalhadosSemana);
      kpiSemanaTrab.textContent = `${trabSem} / 40h`;
      const falta40h = Math.max(0, 2400 - semanaAtual.minutosTrabalhadosSemana);
      kpiSemanaSub.textContent = falta40h > 0
        ? `Restam ${window.PontoCalculations.formatarDuracaoMinutos(falta40h)} para fechar 40h na semana`
        : `Meta semanal de 40h concluída! ✅`;
    }

    // KPI Status Sexta 12h desta Semana
    const kpiSexta12h = document.getElementById('kpi-sexta-12h-status');
    const kpiSexta12hSub = document.getElementById('kpi-sexta-12h-sub');
    if (kpiSexta12h) {
      const trabSegQui = window.PontoCalculations.formatarDuracaoMinutos(semanaAtual.minutosSegAQui);
      kpiSexta12h.textContent = `${semanaAtual.percentualPlanoSexta12h}% (${trabSegQui}/36h)`;
      if (semanaAtual.faltaSegAQuiMin <= 0) {
        kpiSexta12hSub.textContent = `36h Seg-Qui atingidas! Sexta liberada às 12h 🎉`;
      } else {
        kpiSexta12hSub.textContent = `Faltam ${window.PontoCalculations.formatarDuracaoMinutos(semanaAtual.faltaSegAQuiMin)} de Seg-Qui p/ sair Sexta 12h`;
      }
    }
  },

  renderizarAbaHoje(hojeStr, todasMarcacoes, diasEspeciaisMap, semanaAtual, bancoGlobal, agora) {
    const marcacoesHoje = todasMarcacoes.filter(m => m.data === hojeStr);
    const tbody = document.getElementById('tbody-hoje-marcacoes');
    if (tbody) {
      if (marcacoesHoje.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center; color:var(--text-secondary); padding:22px;">
              Nenhuma marcação registrada hoje (${window.PontoCalculations.formatarDataBR(hojeStr)}). Clique em um dos botões acima para bater o ponto.
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = marcacoesHoje.map(m => `
          <tr>
            <td><strong>${this.escapeHtml(m.hora)}</strong></td>
            <td><span class="pill-badge ${this.badgeClassTipo(m.tipo)}">${this.labelTipoBatida(m.tipo)}</span></td>
            <td>
              <span class="pill-badge ${m.modo_registro === 'TEMPO_REAL' ? 'success' : 'warning'}" style="font-size:0.72rem;">
                ${m.modo_registro === 'TEMPO_REAL' ? '⚡ Ao Vivo' : '✏️ Ajustado'}
              </span>
            </td>
            <td>
              <div style="font-size:0.8rem;">${this.escapeHtml(m.ip_publico || 'Local')}</div>
              <div style="font-size:0.72rem; color:var(--text-secondary);">${this.escapeHtml(m.atividade_atual || m.isp_org || '')}</div>
            </td>
            <td>
              ${m.screenshot_dataurl
                ? `<img src="${m.screenshot_dataurl}" class="thumb-preview" onclick="App.abrirModalEvidencia(${m.id})" title="Clique para ampliar comprovante" />`
                : `<span style="color:var(--text-muted); font-size:0.75rem;">Sem print</span>`
              }
            </td>
            <td>
              <button class="btn btn-sm" onclick="App.abrirModalEvidencia(${m.id})" title="Ver Comprovante e Hash SHA-256">🔍</button>
              <button class="btn btn-sm" onclick="App.abrirModalAjuste(${m.id})" title="Editar / Ajustar Horário">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="App.excluirRegistroPonto(${m.id})" title="Excluir">🗑️</button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Painel lateral da Semana & Sexta 12h na Aba 1
    const boxPlanoSexta = document.getElementById('box-plano-sexta-hoje');
    if (boxPlanoSexta) {
      const diasSegSexta = semanaAtual.resumosDias.slice(0, 5);
      boxPlanoSexta.innerHTML = `
        <div style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.84rem; margin-bottom:4px;">
            <span>Acumulado Seg a Qui (Meta 36h p/ sair 12h na Sexta):</span>
            <strong>${window.PontoCalculations.formatarDuracaoMinutos(semanaAtual.minutosSegAQui)} / 36h 00m</strong>
          </div>
          <div class="progress-wrap">
            <div class="progress-bar" style="width:${semanaAtual.percentualPlanoSexta12h}%"></div>
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Trabalhado</th>
                <th>Meta</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              ${diasSegSexta.map(d => `
                <tr style="${d.isHoje ? 'background:rgba(56,189,248,0.08);' : ''}">
                  <td>
                    <strong>${d.nomeDiaCurto}</strong> (${d.data.substring(8, 10)}/${d.data.substring(5, 7)})
                    ${d.isHoje ? '<span class="pill-badge primary" style="padding:1px 6px; font-size:0.68rem;">Hoje</span>' : ''}
                  </td>
                  <td>${window.PontoCalculations.formatarDuracaoMinutos(d.minutosTrabalhados)}</td>
                  <td>${window.PontoCalculations.formatarDuracaoMinutos(d.metaMinutos)}</td>
                  <td style="font-weight:700; color:${!d.contabilizarNoBanco ? 'var(--text-muted)' : (d.saldoMinutos >= 0 ? 'var(--success)' : 'var(--danger)')};">
                    ${d.contabilizarNoBanco ? window.PontoCalculations.formatarDuracaoMinutos(d.saldoMinutos, true) : '--'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin-top:14px; padding:12px; border-radius:8px; background:var(--bg-input); border:1px solid var(--border-highlight); font-size:0.83rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <strong>Vai folgar na Sexta (${window.PontoCalculations.formatarDataBR(semanaAtual.sexta)}) usando o Banco de Horas?</strong>
              <div style="color:var(--text-secondary); font-size:0.77rem;">
                Seu saldo atual é de <strong>${window.PontoCalculations.formatarDuracaoMinutos(bancoGlobal.saldoAcumuladoMin, true)}</strong>.
              </div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="App.alternarFolgaSexta('${semanaAtual.sexta}')">
              ${diasEspeciaisMap[semanaAtual.sexta]?.tipo_dia === 'SEXTA_COMPENSADA_FOLGA'
                ? '↩️ Desmarcar Folga de Sexta'
                : '🏖️ Marcar Sexta como Folga Compensada'}
            </button>
          </div>
        </div>
      `;
    }
  },

  async alternarFolgaSexta(dataSextaStr) {
    const atual = this.db.getDiaEspecial(dataSextaStr);
    if (atual && atual.tipo_dia === 'SEXTA_COMPENSADA_FOLGA') {
      await this.db.salvarDiaEspecial(dataSextaStr, 'NORMAL', null, '');
      this.toast(`Folga compensada removida de ${window.PontoCalculations.formatarDataBR(dataSextaStr)}.`, 'warning');
    } else {
      await this.db.salvarDiaEspecial(
        dataSextaStr,
        'SEXTA_COMPENSADA_FOLGA',
        null,
        'Sexta-feira compensada com saldo do banco de horas'
      );
      this.toast(`Sexta-feira (${window.PontoCalculations.formatarDataBR(dataSextaStr)}) marcada como Folga Compensada no Banco de Horas!`, 'success');
    }
    this.renderizarTudo();
  },

  // ==================== ABA 2: RESUMO DIÁRIO & AJUSTES ====================
  renderizarAbaDiario(todasMarcacoes, diasEspeciaisMap, agora) {
    const inputData = document.getElementById('filtro-data-diario');
    if (inputData && inputData.value !== this.dataFiltroDiario) {
      inputData.value = this.dataFiltroDiario;
    }

    const marcacoesDia = todasMarcacoes.filter(m => m.data === this.dataFiltroDiario);
    const diaEsp = diasEspeciaisMap[this.dataFiltroDiario] || null;
    const resumo = window.PontoCalculations.calcularResumoDia(
      this.dataFiltroDiario,
      marcacoesDia,
      this.config,
      diaEsp,
      agora
    );

    const selectTipoDia = document.getElementById('select-tipo-dia-diario');
    if (selectTipoDia) {
      selectTipoDia.value = diaEsp ? diaEsp.tipo_dia : 'NORMAL';
    }

    const boxResumoDia = document.getElementById('diario-summary-cards');
    if (boxResumoDia) {
      boxResumoDia.innerHTML = `
        <div class="kpi-grid" style="margin-bottom:16px;">
          <div class="kpi-card">
            <div class="kpi-label">DATA SELECIONADA</div>
            <div class="kpi-value" style="font-size:1.35rem;">${window.PontoCalculations.formatarDataBR(resumo.data)}</div>
            <div class="kpi-sub">${resumo.nomeDia} &bull; ${this.labelTipoDia(resumo.tipoDia)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">TEMPO TRABALHADO LÍQUIDO</div>
            <div class="kpi-value" style="font-size:1.45rem;">${window.PontoCalculations.formatarDuracaoMinutos(resumo.minutosTrabalhados)}</div>
            <div class="kpi-sub">Almoço/Pausas: ${window.PontoCalculations.formatarDuracaoMinutos(resumo.minutosAlmoco)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">META DO DIA</div>
            <div class="kpi-value" style="font-size:1.45rem;">${window.PontoCalculations.formatarDuracaoMinutos(resumo.metaMinutos)}</div>
            <div class="kpi-sub">Previsão saída p/ meta: ${resumo.previsaoSaidaMeta || '--:--'}</div>
          </div>
          <div class="kpi-card ${resumo.saldoMinutos >= 0 ? 'kpi-positive' : 'kpi-negative'}">
            <div class="kpi-label">SALDO DO DIA NO BANCO</div>
            <div class="kpi-value" style="font-size:1.45rem; color:${!resumo.contabilizarNoBanco ? 'var(--text-muted)' : (resumo.saldoMinutos >= 0 ? 'var(--success)' : 'var(--danger)')};">
              ${resumo.contabilizarNoBanco ? window.PontoCalculations.formatarDuracaoMinutos(resumo.saldoMinutos, true) : '00h 00m'}
            </div>
            <div class="kpi-sub">${resumo.contabilizarNoBanco ? 'Contabilizado no banco de horas' : 'Sem expediente contabilizado'}</div>
          </div>
        </div>
      `;
    }

    const tbody = document.getElementById('tbody-diario-detalhe');
    if (tbody) {
      if (marcacoesDia.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center; padding:22px; color:var(--text-secondary);">
              Nenhuma batida neste dia. Use o botão <strong>"+ Lançar Ponto Neste Dia"</strong> para adicionar horários caso tenha esquecido de bater.
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = marcacoesDia.map(m => `
          <tr>
            <td><strong>${this.escapeHtml(m.hora)}</strong></td>
            <td><span class="pill-badge ${this.badgeClassTipo(m.tipo)}">${this.labelTipoBatida(m.tipo)}</span></td>
            <td>
              <span class="pill-badge ${m.modo_registro === 'TEMPO_REAL' ? 'success' : 'warning'}">
                ${m.modo_registro === 'TEMPO_REAL' ? 'Tempo Real' : 'Ajuste Manual'}
              </span>
            </td>
            <td>${this.escapeHtml(m.atividade_atual || '-')}</td>
            <td>
              <div>${this.escapeHtml(m.ip_publico || '-')}</div>
              <small style="color:var(--text-secondary);">${this.escapeHtml(m.isp_org || '')}</small>
            </td>
            <td>
              ${m.screenshot_dataurl
                ? `<img src="${m.screenshot_dataurl}" class="thumb-preview" onclick="App.abrirModalEvidencia(${m.id})" />`
                : `<span style="color:var(--text-muted); font-size:0.75rem;">Sem print</span>`}
            </td>
            <td>
              <button class="btn btn-sm" onclick="App.abrirModalEvidencia(${m.id})">🔍 Prova</button>
              <button class="btn btn-sm" onclick="App.abrirModalAjuste(${m.id})">✏️ Editar</button>
              <button class="btn btn-sm btn-danger" onclick="App.excluirRegistroPonto(${m.id})">🗑️</button>
            </td>
          </tr>
        `).join('');
      }
    }
  },

  // ==================== ABA 3: RESUMO SEMANAL & SEXTAS-FEIRAS ====================
  renderizarAbaSemanal(todasMarcacoes, diasEspeciaisMap, bancoGlobal, agora) {
    const inputSem = document.getElementById('filtro-data-semanal');
    if (inputSem && inputSem.value !== this.dataFiltroSemanal) {
      inputSem.value = this.dataFiltroSemanal;
    }

    const sem = window.PontoCalculations.calcularResumoSemana(
      this.dataFiltroSemanal,
      todasMarcacoes,
      diasEspeciaisMap,
      this.config,
      agora
    );

    const labelPeriodo = document.getElementById('semanal-periodo-label');
    if (labelPeriodo) {
      labelPeriodo.textContent = `Semana de ${window.PontoCalculations.formatarDataBR(sem.inicio)} (Seg) a ${window.PontoCalculations.formatarDataBR(sem.fim)} (Dom)`;
    }

    const tbodySem = document.getElementById('tbody-semanal-dias');
    if (tbodySem) {
      tbodySem.innerHTML = sem.resumosDias.map(r => {
        const horariosStr = r.marcacoes.map(m => `${m.hora.substring(0, 5)} (${this.siglaTipoBatida(m.tipo)})`).join(' &rarr; ') || 'Sem registros';
        return `
          <tr style="${r.isSexta ? 'background:rgba(168,85,247,0.06);' : ''}">
            <td>
              <strong>${r.nomeDia}</strong><br/>
              <small style="color:var(--text-secondary);">${window.PontoCalculations.formatarDataBR(r.data)}</small>
            </td>
            <td><span class="pill-badge">${this.labelTipoDia(r.tipoDia)}</span></td>
            <td style="font-size:0.8rem;">${horariosStr}</td>
            <td><strong>${window.PontoCalculations.formatarDuracaoMinutos(r.minutosTrabalhados)}</strong></td>
            <td>${window.PontoCalculations.formatarDuracaoMinutos(r.minutosAlmoco)}</td>
            <td>${window.PontoCalculations.formatarDuracaoMinutos(r.metaMinutos)}</td>
            <td style="font-weight:700; color:${!r.contabilizarNoBanco ? 'var(--text-muted)' : (r.saldoMinutos >= 0 ? 'var(--success)' : 'var(--danger)')};">
              ${r.contabilizarNoBanco ? window.PontoCalculations.formatarDuracaoMinutos(r.saldoMinutos, true) : '--'}
            </td>
            <td>
              <button class="btn btn-sm" onclick="App.irParaDia('${r.data}')">📂 Ver Dia</button>
              <button class="btn btn-sm" onclick="App.abrirModalAjuste(null, '${r.data}')">+ Ponto</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Painel de Controle de Sextas Trabalhadas Após 12h vs Sextas Compensadas
    const boxSextasHist = document.getElementById('box-historico-sextas-compensacao');
    if (boxSextasHist) {
      const extras = bancoGlobal.historicoSextasExtras;
      const folgas = bancoGlobal.historicoSextasFolgadas;

      boxSextasHist.innerHTML = `
        <div class="grid-2col">
          <div style="background:var(--bg-input); padding:16px; border-radius:10px; border:1px solid var(--border-color);">
            <h4 style="margin-bottom:10px; color:#34d399;">⚡ Sextas-Feiras Trabalhadas Após as 12h (${extras.length})</h4>
            ${extras.length === 0 ? `
              <p style="font-size:0.83rem; color:var(--text-secondary);">
                Nenhuma sexta-feira com expediente após as 12h registrada até o momento. Quando você precisar trabalhar na sexta à tarde, o tempo extra aparecerá automaticamente aqui!
              </p>
            ` : `
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Data da Sexta</th>
                    <th>Total no Dia</th>
                    <th>Após 12h</th>
                    <th>Saldo Gerado</th>
                  </tr>
                </thead>
                <tbody>
                  ${extras.map(ex => `
                    <tr>
                      <td><strong>${window.PontoCalculations.formatarDataBR(ex.data)}</strong></td>
                      <td>${window.PontoCalculations.formatarDuracaoMinutos(ex.trabalhadoTotalMin)}</td>
                      <td style="color:var(--primary); font-weight:700;">+${window.PontoCalculations.formatarDuracaoMinutos(ex.apos12hMin)}</td>
                      <td style="color:var(--success); font-weight:700;">${window.PontoCalculations.formatarDuracaoMinutos(ex.saldoGeradoMin, true)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>

          <div style="background:var(--bg-input); padding:16px; border-radius:10px; border:1px solid var(--border-color);">
            <h4 style="margin-bottom:10px; color:#c084fc;">🏖️ Sextas-Feiras Compensadas / Folgas (${folgas.length})</h4>
            ${folgas.length === 0 ? `
              <p style="font-size:0.83rem; color:var(--text-secondary);">
                Você ainda não marcou nenhuma sexta-feira como folga compensada. Seu saldo atual no banco é de <strong>${window.PontoCalculations.formatarDuracaoMinutos(bancoGlobal.saldoAcumuladoMin, true)}</strong> (${bancoGlobal.sextasLivresDisponiveis} sexta(s) disponível(is)).
              </p>
            ` : `
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Data da Folga</th>
                    <th>Tipo</th>
                    <th>Abatido do Banco</th>
                  </tr>
                </thead>
                <tbody>
                  ${folgas.map(f => `
                    <tr>
                      <td><strong>${window.PontoCalculations.formatarDataBR(f.data)}</strong></td>
                      <td>${this.labelTipoDia(f.tipoDia)}</td>
                      <td style="color:var(--warning); font-weight:700;">-${window.PontoCalculations.formatarDuracaoMinutos(f.horasDescontadasMin)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      `;
    }
  },

  // ==================== ABA 4: RESUMO MENSAL ====================
  renderizarAbaMensal(todasMarcacoes, diasEspeciaisMap, bancoGlobal, agora) {
    const inputMes = document.getElementById('filtro-mes-mensal');
    if (inputMes && inputMes.value !== this.mesFiltroMensal) {
      inputMes.value = this.mesFiltroMensal;
    }

    const resMes = window.PontoCalculations.calcularResumoMes(
      this.mesFiltroMensal,
      todasMarcacoes,
      diasEspeciaisMap,
      this.config,
      agora
    );

    const cardsMes = document.getElementById('mensal-summary-cards');
    if (cardsMes) {
      cardsMes.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">MÊS DE REFERÊNCIA</div>
            <div class="kpi-value" style="font-size:1.35rem;">${resMes.nomeMesAno}</div>
            <div class="kpi-sub">${resMes.diasTrabalhadosCount} dia(s) com marcação</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">HORAS TRABALHADAS NO MÊS</div>
            <div class="kpi-value" style="font-size:1.45rem;">${window.PontoCalculations.formatarDuracaoMinutos(resMes.minutosTrabalhadosMes)}</div>
            <div class="kpi-sub">Meta dos dias lançados: ${window.PontoCalculations.formatarDuracaoMinutos(resMes.minutosMetaMesContabilizado)}</div>
          </div>
          <div class="kpi-card ${resMes.saldoMinutosMes >= 0 ? 'kpi-positive' : 'kpi-negative'}">
            <div class="kpi-label">SALDO DO MÊS</div>
            <div class="kpi-value" style="font-size:1.45rem; color:${resMes.saldoMinutosMes >= 0 ? 'var(--success)' : 'var(--danger)'};">
              ${window.PontoCalculations.formatarDuracaoMinutos(resMes.saldoMinutosMes, true)}
            </div>
            <div class="kpi-sub">Sextas após 12h: ${resMes.sextasApos12hCount} | Sextas folgadas: ${resMes.sextasCompensadasCount}</div>
          </div>
          <div class="kpi-card kpi-friday">
            <div class="kpi-label">SALDO GERAL ACUMULADO</div>
            <div class="kpi-value" style="font-size:1.45rem; color:${bancoGlobal.saldoAcumuladoMin >= 0 ? 'var(--success)' : 'var(--danger)'};">
              ${window.PontoCalculations.formatarDuracaoMinutos(bancoGlobal.saldoAcumuladoMin, true)}
            </div>
            <div class="kpi-sub">Inclui todo o histórico no SQLite</div>
          </div>
        </div>
      `;
    }

    const tbodyMes = document.getElementById('tbody-mensal-dias');
    if (tbodyMes) {
      tbodyMes.innerHTML = resMes.resumosDias.map(r => {
        const isFds = (r.diaSemana === 0 || r.diaSemana === 6);
        if (isFds && !r.temMarcacao) return ''; // Oculta sáb/dom vazios para deixar a tabela mensal limpa
        const batidasTxt = r.marcacoes.map(m => m.hora.substring(0, 5)).join(' | ') || '-';
        const ipsDia = Array.from(new Set(r.marcacoes.map(m => m.ip_publico).filter(Boolean))).join(', ') || '-';
        const printsCount = r.marcacoes.filter(m => m.screenshot_dataurl).length;

        return `
          <tr>
            <td><strong>${window.PontoCalculations.formatarDataBR(r.data)}</strong> (${r.nomeDiaCurto})</td>
            <td><span class="pill-badge">${this.labelTipoDia(r.tipoDia)}</span></td>
            <td style="font-family:monospace;">${batidasTxt}</td>
            <td><strong>${window.PontoCalculations.formatarDuracaoMinutos(r.minutosTrabalhados)}</strong></td>
            <td>${window.PontoCalculations.formatarDuracaoMinutos(r.metaMinutos)}</td>
            <td style="font-weight:700; color:${!r.contabilizarNoBanco ? 'var(--text-muted)' : (r.saldoMinutos >= 0 ? 'var(--success)' : 'var(--danger)')};">
              ${r.contabilizarNoBanco ? window.PontoCalculations.formatarDuracaoMinutos(r.saldoMinutos, true) : '--'}
            </td>
            <td style="font-size:0.78rem;">${this.escapeHtml(ipsDia)} (${printsCount} 📷)</td>
            <td>
              <button class="btn btn-sm" onclick="App.irParaDia('${r.data}')">Ver / Ajustar</button>
            </td>
          </tr>
        `;
      }).join('');
    }
  },

  // ==================== ABA 5: GALERIA DE COMPROVAÇÃO & AUDITORIA ====================
  async renderizarAbaEvidencias(todasMarcacoes) {
    const auditBox = document.getElementById('auditoria-chain-status');
    if (auditBox) {
      const ordenadasId = [...todasMarcacoes].sort((a, b) => a.id - b.id);
      const audit = await window.EvidenceCollector.auditarCadeiaRegistros(ordenadasId);
      auditBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <span class="pill-badge ${audit.integro ? 'success' : 'danger'}">
              ${audit.integro ? '🔒 Cadeia Criptográfica SHA-256 Íntegra' : '⚠️ Divergência Detectada'}
            </span>
            <span style="margin-left:10px; font-size:0.85rem; color:var(--text-secondary);">
              Total de registros assinados: <strong>${audit.validos}/${audit.total}</strong>
            </span>
          </div>
          <div>
            <button class="btn btn-primary btn-sm no-print" onclick="window.print()">
              🖨️ Imprimir / Salvar Dossiê de Comprovação em PDF
            </button>
          </div>
        </div>
      `;
    }

    const gallery = document.getElementById('galeria-evidencias-grid');
    if (gallery) {
      const recentesPrimeiro = [...todasMarcacoes].reverse();
      if (recentesPrimeiro.length === 0) {
        gallery.innerHTML = `<div style="color:var(--text-secondary); padding:20px;">Nenhuma evidência registrada ainda.</div>`;
      } else {
        gallery.innerHTML = recentesPrimeiro.map(m => `
          <div class="evidence-card">
            ${m.screenshot_dataurl
              ? `<img src="${m.screenshot_dataurl}" onclick="App.abrirModalEvidencia(${m.id})" alt="Print de Comprovação" />`
              : `<div style="height:190px; display:flex; align-items:center; justify-content:center; background:#090d16; color:var(--text-muted); font-size:0.85rem;">Sem captura de tela anexada</div>`
            }
            <div class="evidence-card-body">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span class="pill-badge ${this.badgeClassTipo(m.tipo)}">${this.labelTipoBatida(m.tipo)}</span>
                <strong>${window.PontoCalculations.formatarDataBR(m.data)} ${this.escapeHtml(m.hora)}</strong>
              </div>
              <div style="margin-bottom:4px;"><strong>Modo:</strong> ${m.modo_registro === 'TEMPO_REAL' ? '⚡ Tempo Real' : '✏️ Ajuste Manual'}</div>
              <div style="margin-bottom:4px;"><strong>IP / Rede:</strong> ${this.escapeHtml(m.ip_publico)} ${m.vpn_detectada ? '✅ VPN' : ''}</div>
              <div style="margin-bottom:4px; color:var(--text-secondary); font-size:0.76rem;">${this.escapeHtml(m.isp_org || '')} ${this.escapeHtml(m.asn || '')}</div>
              ${m.atividade_atual ? `<div style="margin-bottom:6px;"><strong>Atividade:</strong> ${this.escapeHtml(m.atividade_atual)}</div>` : ''}
              <div class="hash-code" title="Assinatura SHA-256">SHA-256: ${this.escapeHtml((m.hash_sha256 || '').substring(0, 36))}...</div>
              <div style="margin-top:10px; display:flex; gap:8px;" class="no-print">
                <button class="btn btn-sm" style="flex:1;" onclick="App.abrirModalEvidencia(${m.id})">🔍 Detalhes Completos</button>
              </div>
            </div>
          </div>
        `).join('');
      }
    }
  },

  // ==================== ABA 6: SQLITE & CONFIGURAÇÕES ====================
  renderizarAbaConfigSQLite() {
    const stats = this.db.getDatabaseStats();
    const elStats = document.getElementById('sqlite-stats-summary');
    if (elStats) {
      elStats.innerHTML = `
        <div class="form-row">
          <div style="background:var(--bg-input); padding:12px; border-radius:8px;">
            <small style="color:var(--text-secondary);">TOTAL DE BATIDAS</small>
            <div style="font-size:1.3rem; font-weight:800;">${stats.totalMarcacoes}</div>
          </div>
          <div style="background:var(--bg-input); padding:12px; border-radius:8px;">
            <small style="color:var(--text-secondary);">DIAS REGISTRADOS</small>
            <div style="font-size:1.3rem; font-weight:800;">${stats.diasUnicos}</div>
          </div>
          <div style="background:var(--bg-input); padding:12px; border-radius:8px;">
            <small style="color:var(--text-secondary);">PRINTS DE COMPROVAÇÃO</small>
            <div style="font-size:1.3rem; font-weight:800;">${stats.totalPrints}</div>
          </div>
          <div style="background:var(--bg-input); padding:12px; border-radius:8px;">
            <small style="color:var(--text-secondary);">TAMANHO DO ARQUIVO .DB</small>
            <div style="font-size:1.3rem; font-weight:800;">${stats.binarySizeKB} KB</div>
          </div>
        </div>
      `;
    }

    // Preenche formulário de configurações
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    setVal('cfg-nome', this.config.nome_colaborador || '');
    setVal('cfg-empresa', this.config.empresa_setor || '');
    setVal('cfg-modo-jornada', this.config.modo_jornada || 'SEXTA_12H');
    setVal('cfg-meta-seg-qui', (Number(this.config.meta_seg_qui_min || 540) / 60));
    setVal('cfg-meta-sexta', (Number(this.config.meta_sexta_min || 240) / 60));
    setVal('cfg-almoco-min', this.config.almoco_padrao_min || '60');
    setVal('cfg-saldo-inicial', this.config.saldo_inicial_min || '0');
    setVal('cfg-vpn-termos', this.config.vpn_termos_conhecidos || '');
  },

  // ==================== EXPORTAÇÃO / IMPORTAÇÃO SQLITE, CSV, JSON ====================
  baixarArquivoSQLite() {
    const bytes = this.db.exportBinary();
    const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seu_ponto_${window.PontoCalculations.hojeStr()}.db`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Arquivo SQLite (.db) exportado com sucesso!', 'success');
  },

  exportarCSV() {
    const rows = this.db.getTodasMarcacoes();
    const headers = [
      'ID', 'Data', 'Hora', 'Tipo', 'Modo_Registro', 'Atividade', 'Justificativa',
      'IP_Publico', 'IP_Local', 'ISP_Org', 'ASN', 'Cidade_UF', 'VPN_Detectada',
      'Sistema_Operacional', 'Resolucao_Tela', 'Hash_SHA256', 'Criado_Em'
    ];
    const csvLines = [headers.join(';')];
    for (const r of rows) {
      const vals = [
        r.id, r.data, r.hora, r.tipo, r.modo_registro,
        `"${(r.atividade_atual || '').replace(/"/g, '""')}"`,
        `"${(r.justificativa || '').replace(/"/g, '""')}"`,
        r.ip_publico, r.ip_local_webrtc,
        `"${(r.isp_org || '').replace(/"/g, '""')}"`,
        r.asn, r.cidade_uf, r.vpn_detectada,
        `"${(r.sistema_operacional || '').replace(/"/g, '""')}"`,
        `"${(r.resolucao_tela || '').replace(/"/g, '""')}"`,
        r.hash_sha256, r.criado_em
      ];
      csvLines.push(vals.join(';'));
    }
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_ponto_${window.PontoCalculations.hojeStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Planilha CSV exportada com sucesso!', 'success');
  },

  exportarJSON() {
    const payload = {
      exportado_em: new Date().toISOString(),
      configuracoes: this.db.getConfigAll(),
      dias_especiais: this.db.getTodosDiasEspeciais(),
      marcacoes: this.db.getTodasMarcacoes()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_seu_ponto_${window.PontoCalculations.hojeStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Backup JSON exportado com sucesso!', 'success');
  },

  // ==================== EVENTOS DE UI ====================
  configurarEventosUI() {
    // Navegação entre abas
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        this.mudarAba(target);
      });
    });

    // Botões de bater ponto em tempo real
    document.querySelectorAll('.btn-punch').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = btn.getAttribute('data-punch-type');
        this.baterPontoTempoReal(tipo);
      });
    });

    // Botão de compartilhamento contínuo de tela (1-clique)
    document.getElementById('btn-toggle-screen-stream')?.addEventListener('click', async () => {
      if (window.EvidenceCollector.isScreenStreamActive()) {
        window.EvidenceCollector.pararMonitoramentoTelaContinuo();
        this.renderizarCardEvidenciaAoVivo();
        this.toast('Compartilhamento contínuo encerrado.', 'warning');
      } else {
        try {
          await window.EvidenceCollector.iniciarMonitoramentoTelaContinuo(() => {
            this.renderizarCardEvidenciaAoVivo();
          });
          this.renderizarCardEvidenciaAoVivo();
          this.toast('Sessão de captura 1-Clique ativa! Agora os prints serão tirados instantaneamente ao bater o ponto.', 'success');
        } catch (err) {
          this.toast(`Não foi possível iniciar captura contínua: ${err.message}`, 'warning');
        }
      }
    });

    // Filtros de data (Diário, Semanal, Mensal)
    document.getElementById('filtro-data-diario')?.addEventListener('change', e => {
      this.dataFiltroDiario = e.target.value;
      this.renderizarTudo();
    });

    document.getElementById('select-tipo-dia-diario')?.addEventListener('change', async e => {
      const novoTipo = e.target.value;
      await this.db.salvarDiaEspecial(this.dataFiltroDiario, novoTipo, null, '');
      this.renderizarTudo();
      this.toast(`Status do dia atualizado para: ${this.labelTipoDia(novoTipo)}`, 'success');
    });

    document.getElementById('filtro-data-semanal')?.addEventListener('change', e => {
      this.dataFiltroSemanal = e.target.value;
      this.renderizarTudo();
    });

    document.getElementById('filtro-mes-mensal')?.addEventListener('change', e => {
      this.mesFiltroMensal = e.target.value;
      this.renderizarTudo();
    });

    // Formulário do Modal de Ajuste
    document.getElementById('form-modal-ajuste')?.addEventListener('submit', e => this.salvarModalAjuste(e));

    // Capturar print agora dentro do modal de ajuste
    document.getElementById('btn-modal-capturar-tela')?.addEventListener('click', async () => {
      try {
        const data = document.getElementById('ajuste-data').value;
        const hora = document.getElementById('ajuste-hora').value;
        const tipo = document.getElementById('ajuste-tipo').value;
        const res = await window.EvidenceCollector.capturarPrintTela({
          metaCarimbo: {
            tipo: this.labelTipoBatida(tipo).toUpperCase(),
            dataHora: `${window.PontoCalculations.formatarDataBR(data)} ${hora}`,
            modo: 'AJUSTE_MANUAL',
            ip: this.netInfo?.ip_publico || 'Local',
            isp: this.netInfo?.isp_org || '',
            ipLocal: this.netInfo?.ip_local_webrtc || '',
            so: this.sysInfo?.sistema_operacional || 'Windows 11'
          }
        });
        this.pastedScreenshotModal = res;
        document.getElementById('ajuste-screenshot-preview').innerHTML = `
          <img src="${res.dataUrl}" style="max-height:130px; border-radius:6px; border:1px solid var(--primary);" />
        `;
      } catch (err) {
        this.toast(`Captura cancelada: ${err.message}`, 'warning');
      }
    });

    // Upload de imagem no modal de ajuste
    document.getElementById('input-modal-file-print')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const res = await window.EvidenceCollector.processarImagemExterna(file, {
        tipo: 'COMPROVANTE ANEXADO',
        modo: 'AJUSTE_MANUAL',
        ip: this.netInfo?.ip_publico || 'Local',
        so: this.sysInfo?.sistema_operacional || 'Windows 11'
      });
      this.pastedScreenshotModal = res;
      document.getElementById('ajuste-screenshot-preview').innerHTML = `
        <img src="${res.dataUrl}" style="max-height:130px; border-radius:6px; border:1px solid var(--primary);" />
      `;
    });

    // Colar Print com Ctrl+V em qualquer lugar quando o modal de ajuste estiver aberto (ou na tela principal)
    window.addEventListener('paste', async e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (!blob) continue;
          const modalAberto = document.getElementById('modal-ajuste-ponto')?.classList.contains('open');
          if (!modalAberto) {
            this.abrirModalAjuste(null, window.PontoCalculations.hojeStr());
          }
          const res = await window.EvidenceCollector.processarImagemExterna(blob, {
            tipo: 'PRINT COLADO (CTRL+V)',
            modo: 'COMPROVACAO',
            ip: this.netInfo?.ip_publico || 'Local',
            so: this.sysInfo?.sistema_operacional || 'Windows 11'
          });
          this.pastedScreenshotModal = res;
          document.getElementById('ajuste-screenshot-preview').innerHTML = `
            <img src="${res.dataUrl}" style="max-height:130px; border-radius:6px; border:1px solid var(--success);" />
          `;
          this.toast('Print da área de transferência colado com carimbo forense!', 'success');
        }
      }
    });

    // Salvar Configurações
    document.getElementById('form-configuracoes')?.addEventListener('submit', async e => {
      e.preventDefault();
      const segQuiHoras = parseFloat(document.getElementById('cfg-meta-seg-qui').value) || 9;
      const sextaHoras = parseFloat(document.getElementById('cfg-meta-sexta').value) || 4;
      await this.db.setMultipleConfigs({
        nome_colaborador: document.getElementById('cfg-nome').value.trim() || 'Colaborador',
        empresa_setor: document.getElementById('cfg-empresa').value.trim() || '',
        modo_jornada: document.getElementById('cfg-modo-jornada').value,
        meta_seg_qui_min: Math.round(segQuiHoras * 60),
        meta_sexta_min: Math.round(sextaHoras * 60),
        almoco_padrao_min: parseInt(document.getElementById('cfg-almoco-min').value, 10) || 60,
        saldo_inicial_min: parseInt(document.getElementById('cfg-saldo-inicial').value, 10) || 0,
        vpn_termos_conhecidos: document.getElementById('cfg-vpn-termos').value.trim()
      });
      this.config = this.db.getConfigAll();
      await this.atualizarTelemetriaAmbiente(true);
      this.renderizarTudo();
      this.toast('Configurações salvas no banco SQLite!', 'success');
    });

    // Importar arquivo .db via input file
    document.getElementById('input-import-sqlite')?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        await this.db.importarBinarioSQLite(new Uint8Array(buf));
        this.renderizarTudo();
        this.toast(`Banco SQLite "${file.name}" importado com sucesso!`, 'success');
      } catch (err) {
        this.toast(`Arquivo inválido: ${err.message}`, 'danger');
      }
    });

    // Executar consulta SQL customizada na Aba 6
    document.getElementById('btn-executar-sql')?.addEventListener('click', () => {
      const sqlInput = document.getElementById('textarea-sql-custom');
      const outBox = document.getElementById('sql-query-output');
      if (!sqlInput || !outBox) return;
      try {
        const rows = this.db.queryAll(sqlInput.value);
        outBox.textContent = JSON.stringify(rows, null, 2);
      } catch (err) {
        outBox.textContent = `Erro SQL: ${err.message}`;
      }
    });
  },

  mudarAba(tabId) {
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `tab-${tabId}`);
    });
  },

  irParaDia(dataStr) {
    this.dataFiltroDiario = dataStr;
    this.renderizarTudo();
    this.mudarAba('diario');
  },

  // ==================== HELPERS DE FORMATAÇÃO ====================
  labelTipoBatida(tipo) {
    const map = {
      ENTRADA: 'Entrada (Início)',
      ALMOCO_INICIO: 'Saída p/ Almoço',
      ALMOCO_FIM: 'Retorno do Almoço',
      SAIDA: 'Saída (Fim do Expediente)',
      PAUSA_INICIO: 'Início de Pausa',
      PAUSA_FIM: 'Fim de Pausa'
    };
    return map[tipo] || tipo;
  },

  siglaTipoBatida(tipo) {
    const map = {
      ENTRADA: 'Ent',
      ALMOCO_INICIO: 'Alm.Ini',
      ALMOCO_FIM: 'Alm.Fim',
      SAIDA: 'Saída'
    };
    return map[tipo] || tipo;
  },

  badgeClassTipo(tipo) {
    if (tipo === 'ENTRADA') return 'success';
    if (tipo === 'ALMOCO_INICIO') return 'warning';
    if (tipo === 'ALMOCO_FIM') return 'primary';
    if (tipo === 'SAIDA') return 'purple';
    return '';
  },

  labelTipoDia(tipoDia) {
    const map = {
      NORMAL: 'Dia Normal',
      SEXTA_12H: 'Sexta até 12h (4h)',
      SEXTA_COMPENSADA_FOLGA: '🏖️ Sexta Compensada (Folga Banco)',
      FOLGA_BANCO: '🏖️ Folga (Banco de Horas)',
      FERIADO: '🎉 Feriado (Sem desconto)',
      ABONO_ATESTADO: '🏥 Abono / Atestado'
    };
    return map[tipoDia] || tipoDia;
  },

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  toast(msg, type = 'primary') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 250);
    }, 4200);
  }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
