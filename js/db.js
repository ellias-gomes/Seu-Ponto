/**
 * Motor de Banco de Dados SQLite Local (via sql.js WASM offline)
 * Suporta:
 * 1. Armazenamento automático em IndexedDB (persistência instantânea no navegador)
 * 2. Sincronização direta com arquivo físico .db / .sqlite no Windows 11 (File System Access API)
 * 3. Exportação / Importação de arquivo binário SQLite3 (.db), JSON e CSV
 */

class PontoDatabase {
  constructor() {
    this.SQL = null;
    this.db = null;
    this.fileHandle = null; // FileSystemFileHandle para salvar direto no disco (OneDrive/pasta local)
    this.idbName = 'SeuPontoSQLiteStorage';
    this.idbStore = 'sqlite_binary';
    this.idbKey = 'seu_ponto_db';
    this.lastSavedAt = null;
    this.onSyncStatusChange = null;
  }

  async init() {
    // Decodifica o binário WASM embutido em base64 (funciona até em file:// sem servidor e sem internet)
    let wasmBinary = null;
    if (window.SQL_WASM_BASE64) {
      const binaryString = atob(window.SQL_WASM_BASE64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      wasmBinary = bytes.buffer;
    }

    this.SQL = await window.initSqlJs({
      wasmBinary: wasmBinary || undefined,
      locateFile: file => `vendor/${file}`
    });

    const savedBytes = await this._loadFromIndexedDB();
    if (savedBytes && savedBytes.byteLength > 0) {
      this.db = new this.SQL.Database(new Uint8Array(savedBytes));
      this._createTablesAndMigrate();
    } else {
      this.db = new this.SQL.Database();
      this._createTablesAndMigrate();
      await this.persist();
    }

    return this;
  }

  _createTablesAndMigrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS marcacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,                 -- YYYY-MM-DD
        hora TEXT NOT NULL,                 -- HH:MM:SS
        timestamp_iso TEXT NOT NULL,        -- ISO 8601 completo
        tipo TEXT NOT NULL,                 -- ENTRADA | ALMOCO_INICIO | ALMOCO_FIM | SAIDA
        modo_registro TEXT NOT NULL,        -- TEMPO_REAL | AJUSTE_MANUAL
        justificativa TEXT DEFAULT '',      -- Motivo se for ajuste manual ou observação
        atividade_atual TEXT DEFAULT '',    -- O que estava fazendo / entregando
        ip_publico TEXT DEFAULT '',         -- IP de saída (VPN / internet)
        ip_local_webrtc TEXT DEFAULT '',    -- IP de interface local / túnel
        isp_org TEXT DEFAULT '',            -- Provedor / Organização da VPN
        asn TEXT DEFAULT '',                -- ASN da rede
        cidade_uf TEXT DEFAULT '',          -- Localização aproximada do IP
        vpn_detectada INTEGER DEFAULT 0,    -- 1 se VPN identificada, 0 caso contrário
        user_agent TEXT DEFAULT '',
        sistema_operacional TEXT DEFAULT '',
        resolucao_tela TEXT DEFAULT '',
        bateria_info TEXT DEFAULT '',
        fuso_horario TEXT DEFAULT '',
        screenshot_dataurl TEXT DEFAULT '', -- Imagem WebP/JPEG em Base64 com carimbo
        screenshot_hash TEXT DEFAULT '',    -- SHA-256 da imagem
        hash_anterior TEXT DEFAULT '',      -- SHA-256 do registro anterior (cadeia de custódia)
        hash_sha256 TEXT DEFAULT '',        -- SHA-256 deste registro
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_marcacoes_data ON marcacoes(data);
      CREATE INDEX IF NOT EXISTS idx_marcacoes_data_hora ON marcacoes(data, hora);

      CREATE TABLE IF NOT EXISTS dias_especiais (
        data TEXT PRIMARY KEY,              -- YYYY-MM-DD
        tipo_dia TEXT NOT NULL,             -- NORMAL | SEXTA_12H | SEXTA_COMPENSADA_FOLGA | SEXTA_TRABALHADA_EXTRA | FERIADO | ABONO_ATESTADO | FOLGA_BANCO
        meta_minutos_custom INTEGER,        -- Se preenchido, sobrescreve a meta padrão do dia
        observacao TEXT DEFAULT '',
        atualizado_em TEXT NOT NULL
      );
    `);

    const defaults = {
      nome_colaborador: 'Colaborador',
      empresa_setor: 'Ambiente Corporativo',
      modo_jornada: 'SEXTA_12H',          // 'SEXTA_12H' (9h Seg-Qui + 4h Sex) ou 'PADRAO_8H' (8h Seg-Sex)
      meta_seg_qui_min: '540',            // 9 horas = 540 min (no modo SEXTA_12H)
      meta_sexta_min: '240',              // 4 horas = 240 min (no modo SEXTA_12H, saindo 12h)
      meta_padrao_diaria_min: '480',      // 8 horas = 480 min (no modo PADRAO_8H)
      meta_semanal_min: '2400',           // 40 horas = 2400 min
      almoco_padrao_min: '60',            // 1 hora = 60 min
      horario_entrada_padrao: '08:00',
      saldo_inicial_min: '0',             // Saldo anterior migrado (em minutos, pode ser + ou -)
      vpn_termos_conhecidos: '',          // Ex: nome da empresa, ASN ou prefixo de IP da VPN
      captura_tela_automatica: '1',       // 1 = solicitar/capturar print ao bater ponto em tempo real
      qualidade_print: '0.78'             // Qualidade WebP/JPEG para manter o .db leve e legível
    };

    const stmt = this.db.prepare(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)`);
    for (const [k, v] of Object.entries(defaults)) {
      stmt.run([k, v]);
    }
    stmt.free();
  }

  // ==================== CONFIGURAÇÕES ====================
  getConfigAll() {
    const res = this.queryAll(`SELECT chave, valor FROM configuracoes`);
    const cfg = {};
    for (const row of res) {
      cfg[row.chave] = row.valor;
    }
    return cfg;
  }

  async setConfig(chave, valor) {
    this.db.run(`INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)`, [chave, String(valor)]);
    await this.persist();
  }

  async setMultipleConfigs(obj) {
    this.db.run('BEGIN TRANSACTION');
    try {
      const stmt = this.db.prepare(`INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)`);
      for (const [k, v] of Object.entries(obj)) {
        stmt.run([k, String(v)]);
      }
      stmt.free();
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    await this.persist();
  }

  // ==================== CONSULTAS AUXILIARES ====================
  queryAll(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  queryOne(sql, params = []) {
    const rows = this.queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  // ==================== MARCAÇÕES DE PONTO ====================
  getUltimoRegistro() {
    return this.queryOne(`SELECT * FROM marcacoes ORDER BY id DESC LIMIT 1`);
  }

  getMarcacoesPorData(dataStr) {
    return this.queryAll(`SELECT * FROM marcacoes WHERE data = ? ORDER BY hora ASC, id ASC`, [dataStr]);
  }

  getMarcacoesPeriodo(dataInicio, dataFim) {
    return this.queryAll(
      `SELECT * FROM marcacoes WHERE data >= ? AND data <= ? ORDER BY data ASC, hora ASC, id ASC`,
      [dataInicio, dataFim]
    );
  }

  getTodasMarcacoes() {
    return this.queryAll(`SELECT * FROM marcacoes ORDER BY data ASC, hora ASC, id ASC`);
  }

  getMarcacaoById(id) {
    return this.queryOne(`SELECT * FROM marcacoes WHERE id = ?`, [Number(id)]);
  }

  async inserirMarcacao(dados) {
    const agoraIso = new Date().toISOString();
    const ultimo = this.getUltimoRegistro();
    const hashAnterior = ultimo ? (ultimo.hash_sha256 || 'GENESIS') : 'GENESIS';

    const registroBase = {
      data: dados.data,
      hora: dados.hora,
      timestamp_iso: dados.timestamp_iso || agoraIso,
      tipo: dados.tipo,
      modo_registro: dados.modo_registro || 'TEMPO_REAL',
      justificativa: dados.justificativa || '',
      atividade_atual: dados.atividade_atual || '',
      ip_publico: dados.ip_publico || 'Não identificado',
      ip_local_webrtc: dados.ip_local_webrtc || '',
      isp_org: dados.isp_org || '',
      asn: dados.asn || '',
      cidade_uf: dados.cidade_uf || '',
      vpn_detectada: dados.vpn_detectada ? 1 : 0,
      user_agent: dados.user_agent || navigator.userAgent,
      sistema_operacional: dados.sistema_operacional || '',
      resolucao_tela: dados.resolucao_tela || '',
      bateria_info: dados.bateria_info || '',
      fuso_horario: dados.fuso_horario || Intl.DateTimeFormat().resolvedOptions().timeZone,
      screenshot_dataurl: dados.screenshot_dataurl || '',
      screenshot_hash: dados.screenshot_hash || '',
      hash_anterior: hashAnterior,
      criado_em: agoraIso,
      atualizado_em: agoraIso
    };

    // Calcula hash SHA-256 da cadeia de custódia
    const payloadHash = [
      registroBase.data,
      registroBase.hora,
      registroBase.tipo,
      registroBase.modo_registro,
      registroBase.ip_publico,
      registroBase.ip_local_webrtc,
      registroBase.isp_org,
      registroBase.screenshot_hash,
      registroBase.hash_anterior,
      registroBase.criado_em
    ].join('|');

    registroBase.hash_sha256 = await window.EvidenceCollector.sha256(payloadHash);

    this.db.run(
      `INSERT INTO marcacoes (
        data, hora, timestamp_iso, tipo, modo_registro, justificativa, atividade_atual,
        ip_publico, ip_local_webrtc, isp_org, asn, cidade_uf, vpn_detectada,
        user_agent, sistema_operacional, resolucao_tela, bateria_info, fuso_horario,
        screenshot_dataurl, screenshot_hash, hash_anterior, hash_sha256, criado_em, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        registroBase.data,
        registroBase.hora,
        registroBase.timestamp_iso,
        registroBase.tipo,
        registroBase.modo_registro,
        registroBase.justificativa,
        registroBase.atividade_atual,
        registroBase.ip_publico,
        registroBase.ip_local_webrtc,
        registroBase.isp_org,
        registroBase.asn,
        registroBase.cidade_uf,
        registroBase.vpn_detectada,
        registroBase.user_agent,
        registroBase.sistema_operacional,
        registroBase.resolucao_tela,
        registroBase.bateria_info,
        registroBase.fuso_horario,
        registroBase.screenshot_dataurl,
        registroBase.screenshot_hash,
        registroBase.hash_anterior,
        registroBase.hash_sha256,
        registroBase.criado_em,
        registroBase.atualizado_em
      ]
    );

    const inserted = this.getUltimoRegistro();
    await this.persist();
    return inserted;
  }

  async atualizarMarcacao(id, dados) {
    const existente = this.getMarcacaoById(id);
    if (!existente) throw new Error('Marcação não encontrada');

    const agoraIso = new Date().toISOString();
    const novaData = dados.data || existente.data;
    const novaHora = dados.hora || existente.hora;
    const novoTipo = dados.tipo || existente.tipo;
    const novaJustificativa = dados.justificativa !== undefined ? dados.justificativa : existente.justificativa;
    const novaAtividade = dados.atividade_atual !== undefined ? dados.atividade_atual : existente.atividade_atual;
    const novoScreenshot = dados.screenshot_dataurl !== undefined ? dados.screenshot_dataurl : existente.screenshot_dataurl;
    const novoScreenshotHash = dados.screenshot_hash !== undefined ? dados.screenshot_hash : existente.screenshot_hash;

    // Se o horário/data mudou depois de criado, marca como AJUSTE_MANUAL para transparência da auditoria
    const mudouHorario = (novaData !== existente.data || novaHora !== existente.hora);
    const novoModo = mudouHorario ? 'AJUSTE_MANUAL' : (dados.modo_registro || existente.modo_registro);

    const payloadHash = [
      novaData,
      novaHora,
      novoTipo,
      novoModo,
      existente.ip_publico,
      existente.ip_local_webrtc,
      existente.isp_org,
      novoScreenshotHash,
      existente.hash_anterior,
      existente.criado_em,
      agoraIso
    ].join('|');

    const novoHash = await window.EvidenceCollector.sha256(payloadHash);

    this.db.run(
      `UPDATE marcacoes SET
        data = ?, hora = ?, tipo = ?, modo_registro = ?,
        justificativa = ?, atividade_atual = ?,
        screenshot_dataurl = ?, screenshot_hash = ?,
        hash_sha256 = ?, atualizado_em = ?
       WHERE id = ?`,
      [
        novaData, novaHora, novoTipo, novoModo,
        novaJustificativa, novaAtividade,
        novoScreenshot, novoScreenshotHash,
        novoHash, agoraIso, Number(id)
      ]
    );

    await this.persist();
    return this.getMarcacaoById(id);
  }

  async excluirMarcacao(id) {
    this.db.run(`DELETE FROM marcacoes WHERE id = ?`, [Number(id)]);
    await this.persist();
  }

  // ==================== DIAS ESPECIAIS (SEXTA COMPENSADA / FERIADO / ABONO) ====================
  getDiaEspecial(dataStr) {
    return this.queryOne(`SELECT * FROM dias_especiais WHERE data = ?`, [dataStr]);
  }

  getTodosDiasEspeciais() {
    const rows = this.queryAll(`SELECT * FROM dias_especiais ORDER BY data ASC`);
    const map = {};
    for (const r of rows) {
      map[r.data] = r;
    }
    return map;
  }

  async salvarDiaEspecial(dataStr, tipoDia, metaMinutosCustom = null, observacao = '') {
    const agoraIso = new Date().toISOString();
    if (tipoDia === 'NORMAL' && (metaMinutosCustom === null || metaMinutosCustom === '') && !observacao) {
      this.db.run(`DELETE FROM dias_especiais WHERE data = ?`, [dataStr]);
    } else {
      const metaVal = (metaMinutosCustom !== null && metaMinutosCustom !== '') ? Number(metaMinutosCustom) : null;
      this.db.run(
        `INSERT OR REPLACE INTO dias_especiais (data, tipo_dia, meta_minutos_custom, observacao, atualizado_em)
         VALUES (?, ?, ?, ?, ?)`,
        [dataStr, tipoDia, metaVal, observacao, agoraIso]
      );
    }
    await this.persist();
  }

  // ==================== PERSISTÊNCIA INDEXEDDB & ARQUIVO .DB ====================
  exportBinary() {
    return this.db.export(); // Uint8Array do arquivo SQLite3 real
  }

  async persist() {
    const binary = this.exportBinary();
    await this._saveToIndexedDB(binary);
    this.lastSavedAt = new Date();

    // Se o usuário vinculou um arquivo .db local via File System Access API, grava nele também!
    if (this.fileHandle) {
      try {
        const writable = await this.fileHandle.createWritable();
        await writable.write(binary);
        await writable.close();
        if (this.onSyncStatusChange) {
          this.onSyncStatusChange({
            connected: true,
            fileName: this.fileHandle.name,
            lastSaved: this.lastSavedAt
          });
        }
      } catch (err) {
        console.warn('Não foi possível gravar automaticamente no arquivo vinculado:', err);
        if (this.onSyncStatusChange) {
          this.onSyncStatusChange({
            connected: false,
            error: err.message,
            lastSaved: this.lastSavedAt
          });
        }
      }
    } else if (this.onSyncStatusChange) {
      this.onSyncStatusChange({
        connected: false,
        fileName: null,
        lastSaved: this.lastSavedAt
      });
    }
  }

  async vincularArquivoLocalSalvar() {
    if (!window.showSaveFilePicker) {
      throw new Error('Seu navegador não suporta vínculo direto de arquivo (use Edge ou Chrome no Windows 11, ou use o botão Baixar .db).');
    }
    this.fileHandle = await window.showSaveFilePicker({
      suggestedName: 'seu_ponto.db',
      types: [
        {
          description: 'Banco de Dados SQLite3 (.db / .sqlite)',
          accept: { 'application/x-sqlite3': ['.db', '.sqlite', '.sqlite3'] }
        }
      ]
    });
    await this.persist();
    return this.fileHandle.name;
  }

  async abrirArquivoLocalExistente() {
    if (!window.showOpenFilePicker) {
      throw new Error('Use a opção Importar Arquivo .db.');
    }
    const [handle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'Banco de Dados SQLite3 (.db / .sqlite)',
          accept: { 'application/x-sqlite3': ['.db', '.sqlite', '.sqlite3'] }
        }
      ],
      multiple: false
    });
    const file = await handle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    await this.importarBinarioSQLite(new Uint8Array(arrayBuffer));
    this.fileHandle = handle;
    await this.persist();
    return handle.name;
  }

  async importarBinarioSQLite(uint8Array) {
    const newDb = new this.SQL.Database(uint8Array);
    // Verifica se é um banco SQLite válido
    newDb.run(`SELECT count(*) FROM sqlite_master`);
    if (this.db) {
      this.db.close();
    }
    this.db = newDb;
    this._createTablesAndMigrate();
    await this.persist();
  }

  _openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.idbName, 1);
      req.onupgradeneeded = e => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains(this.idbStore)) {
          idb.createObjectStore(this.idbStore);
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async _saveToIndexedDB(uint8Array) {
    const idb = await this._openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(this.idbStore, 'readwrite');
      const store = tx.objectStore(this.idbStore);
      store.put(uint8Array, this.idbKey);
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = e => {
        idb.close();
        reject(e.target.error);
      };
    });
  }

  async _loadFromIndexedDB() {
    try {
      const idb = await this._openIDB();
      return await new Promise((resolve, reject) => {
        const tx = idb.transaction(this.idbStore, 'readonly');
        const store = tx.objectStore(this.idbStore);
        const req = store.get(this.idbKey);
        req.onsuccess = () => {
          idb.close();
          resolve(req.result || null);
        };
        req.onerror = e => {
          idb.close();
          reject(e.target.error);
        };
      });
    } catch (e) {
      console.warn('Falha ao ler IndexedDB:', e);
      return null;
    }
  }

  getDatabaseStats() {
    const totalMarcacoes = this.queryOne(`SELECT COUNT(*) as total FROM marcacoes`)?.total || 0;
    const totalPrints = this.queryOne(`SELECT COUNT(*) as total FROM marcacoes WHERE screenshot_dataurl != ''`)?.total || 0;
    const diasUnicos = this.queryOne(`SELECT COUNT(DISTINCT data) as total FROM marcacoes`)?.total || 0;
    const binarySize = this.exportBinary().byteLength;
    return {
      totalMarcacoes,
      totalPrints,
      diasUnicos,
      binarySizeKB: Math.round(binarySize / 1024)
    };
  }
}

window.PontoDatabase = PontoDatabase;
