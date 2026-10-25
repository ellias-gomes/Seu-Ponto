/**
 * Motor de Cálculo de Jornada, Banco de Horas, Resumos (Diário, Semanal, Mensal)
 * e Inteligência da Sexta-Feira 12h / Compensação de Sextas
 */

const PontoCalculations = {
  DIAS_SEMANA: [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado'
  ],

  DIAS_SEMANA_CURTO: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],

  MESES: [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ],

  // ==================== UTILITÁRIOS DE DATA E HORA ====================
  hojeStr() {
    const d = new Date();
    return this.dateToYMD(d);
  },

  dateToYMD(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  parseYMD(dataStr) {
    const [y, m, d] = dataStr.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  },

  formatarDataBR(dataStr) {
    if (!dataStr) return '';
    const [y, m, d] = dataStr.split('-');
    return `${d}/${m}/${y}`;
  },

  getDiaSemanaIndex(dataStr) {
    return this.parseYMD(dataStr).getDay(); // 0=Dom .. 5=Sex, 6=Sab
  },

  getNomeDiaSemana(dataStr, curto = false) {
    const idx = this.getDiaSemanaIndex(dataStr);
    return curto ? this.DIAS_SEMANA_CURTO[idx] : this.DIAS_SEMANA[idx];
  },

  horaParaSegundos(horaStr) {
    if (!horaStr) return 0;
    const parts = horaStr.split(':').map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    return h * 3600 + m * 60 + s;
  },

  segundosParaHora(totalSegundos, incluirSegundos = false) {
    const abs = Math.max(0, Math.round(totalSegundos));
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = abs % 60;
    if (incluirSegundos) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  formatarDuracaoMinutos(minutosFloat, mostrarSinal = false) {
    const isNeg = minutosFloat < -0.01;
    const absMin = Math.round(Math.abs(minutosFloat));
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    const sinal = isNeg ? '-' : (mostrarSinal && absMin > 0 ? '+' : '');
    return `${sinal}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  },

  formatarDuracaoSegundos(segundosTotal, mostrarSinal = false) {
    const isNeg = segundosTotal < 0;
    const absSec = Math.round(Math.abs(segundosTotal));
    const h = Math.floor(absSec / 3600);
    const m = Math.floor((absSec % 3600) / 60);
    const s = absSec % 60;
    const sinal = isNeg ? '-' : (mostrarSinal && absSec > 0 ? '+' : '');
    return `${sinal}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  },

  // Retorna a Segunda-feira e o Domingo da semana de uma data YYYY-MM-DD
  getLimitesSemana(dataStr) {
    const dt = this.parseYMD(dataStr);
    const day = dt.getDay();
    // Ajusta para Segunda-feira ser o início da semana (se Domingo=0, recua 6 dias)
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(dt);
    monday.setDate(dt.getDate() + diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const dias = [];
    for (let i = 0; i < 7; i++) {
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + i);
      dias.push(this.dateToYMD(cur));
    }

    return {
      inicio: this.dateToYMD(monday),
      fim: this.dateToYMD(sunday),
      sexta: dias[4],
      dias
    };
  },

  // ==================== META DO DIA ====================
  calcularMetaDiaMinutos(dataStr, config, diaEspecial = null) {
    if (diaEspecial && diaEspecial.meta_minutos_custom !== null && diaEspecial.meta_minutos_custom !== undefined && diaEspecial.meta_minutos_custom !== '') {
      return Number(diaEspecial.meta_minutos_custom);
    }

    const tipoDia = diaEspecial ? diaEspecial.tipo_dia : 'NORMAL';
    if (tipoDia === 'FERIADO' || tipoDia === 'ABONO_ATESTADO') {
      return 0;
    }

    const diaSemana = this.getDiaSemanaIndex(dataStr); // 0=Dom, 1..4=Seg..Qui, 5=Sex, 6=Sab
    if (diaSemana === 0 || diaSemana === 6) {
      return 0;
    }

    const modo = config.modo_jornada || 'SEXTA_12H';
    if (modo === 'SEXTA_12H') {
      if (diaSemana >= 1 && diaSemana <= 4) {
        return Number(config.meta_seg_qui_min || 540); // 9h = 540m
      }
      if (diaSemana === 5) {
        return Number(config.meta_sexta_min || 240);   // 4h = 240m (Sair às 12h)
      }
    } else {
      // Modo PADRAO_8H (8h de Seg a Sex)
      return Number(config.meta_padrao_diaria_min || 480);
    }
    return 480;
  },

  // ==================== CÁLCULO DETALHADO DO DIA ====================
  calcularResumoDia(dataStr, marcacoesDia = [], config = {}, diaEspecial = null, agoraDate = new Date()) {
    const hoje = this.dateToYMD(agoraDate);
    const isHoje = dataStr === hoje;
    const diaSemana = this.getDiaSemanaIndex(dataStr);
    const isSexta = diaSemana === 5;
    const tipoDia = diaEspecial ? diaEspecial.tipo_dia : (isSexta && config.modo_jornada === 'SEXTA_12H' ? 'SEXTA_12H' : 'NORMAL');

    const metaMinutos = this.calcularMetaDiaMinutos(dataStr, config, diaEspecial);
    const ordenadas = [...marcacoesDia].sort((a, b) => a.hora.localeCompare(b.hora) || (a.id - b.id));

    let segundosTrabalhados = 0;
    let segundosAlmoco = 0;
    let inicioTurnoSeg = null;
    let inicioAlmocoSeg = null;
    let primeiraEntradaSeg = null;
    let ultimaSaidaSeg = null;
    let jaAlmocou = false;

    const intervalosTrabalho = [];

    for (const m of ordenadas) {
      const seg = this.horaParaSegundos(m.hora);
      if (m.tipo === 'ENTRADA') {
        if (primeiraEntradaSeg === null) primeiraEntradaSeg = seg;
        if (inicioTurnoSeg === null) inicioTurnoSeg = seg;
      } else if (m.tipo === 'ALMOCO_INICIO' || m.tipo === 'PAUSA_INICIO') {
        if (inicioTurnoSeg !== null && seg >= inicioTurnoSeg) {
          segundosTrabalhados += (seg - inicioTurnoSeg);
          intervalosTrabalho.push({ inicio: inicioTurnoSeg, fim: seg, fechado: true });
          inicioTurnoSeg = null;
        }
        inicioAlmocoSeg = seg;
      } else if (m.tipo === 'ALMOCO_FIM' || m.tipo === 'PAUSA_FIM') {
        if (inicioAlmocoSeg !== null && seg >= inicioAlmocoSeg) {
          segundosAlmoco += (seg - inicioAlmocoSeg);
          inicioAlmocoSeg = null;
          jaAlmocou = true;
        }
        if (inicioTurnoSeg === null) {
          inicioTurnoSeg = seg;
        }
      } else if (m.tipo === 'SAIDA') {
        if (inicioAlmocoSeg !== null && seg >= inicioAlmocoSeg) {
          segundosAlmoco += (seg - inicioAlmocoSeg);
          inicioAlmocoSeg = null;
        }
        if (inicioTurnoSeg !== null && seg >= inicioTurnoSeg) {
          segundosTrabalhados += (seg - inicioTurnoSeg);
          intervalosTrabalho.push({ inicio: inicioTurnoSeg, fim: seg, fechado: true });
          inicioTurnoSeg = null;
        }
        ultimaSaidaSeg = seg;
      }
    }

    const agoraSeg = agoraDate.getHours() * 3600 + agoraDate.getMinutes() * 60 + agoraDate.getSeconds();
    let emAndamento = false;
    let emAlmoco = false;

    if (isHoje) {
      if (inicioTurnoSeg !== null && agoraSeg >= inicioTurnoSeg) {
        segundosTrabalhados += (agoraSeg - inicioTurnoSeg);
        intervalosTrabalho.push({ inicio: inicioTurnoSeg, fim: agoraSeg, fechado: false });
        emAndamento = true;
      }
      if (inicioAlmocoSeg !== null && agoraSeg >= inicioAlmocoSeg) {
        segundosAlmoco += (agoraSeg - inicioAlmocoSeg);
        emAlmoco = true;
      }
    }

    const minutosTrabalhados = segundosTrabalhados / 60;
    const minutosAlmoco = segundosAlmoco / 60;

    // Define se o dia deve contabilizar no Banco de Horas
    const temMarcacao = ordenadas.length > 0;
    const isFolgaCompensada = (tipoDia === 'SEXTA_COMPENSADA_FOLGA' || tipoDia === 'FOLGA_BANCO');
    const isFeriadoOuAbono = (tipoDia === 'FERIADO' || tipoDia === 'ABONO_ATESTADO');
    const contabilizarNoBanco = temMarcacao || isFolgaCompensada || isFeriadoOuAbono;

    const saldoMinutos = contabilizarNoBanco ? (minutosTrabalhados - metaMinutos) : 0;
    const saldoSegundos = contabilizarNoBanco ? (segundosTrabalhados - metaMinutos * 60) : 0;

    // Previsão de horário de saída (para fechar a meta do dia, 8h e 9h)
    let previsaoSaidaMeta = null;
    let previsaoSaida8h = null;
    let previsaoSaida9h = null;
    const almocoPadraoSeg = Number(config.almoco_padrao_min || 60) * 60;

    if (primeiraEntradaSeg !== null) {
      // Se ainda não tirou almoço e a meta for > 6h (ex: Seg-Qui), considera o almoço padrão se ainda não almoçou
      const descontoAlmocoPrevisto = (jaAlmocou || segundosAlmoco > 0)
        ? segundosAlmoco
        : (metaMinutos > 360 ? almocoPadraoSeg : 0);

      const calcHoraSaida = (alvoMinutos, considerarAlmoco = true) => {
        const alvoSeg = alvoMinutos * 60;
        const almocoSeg = considerarAlmoco
          ? ((jaAlmocou || segundosAlmoco > 0) ? segundosAlmoco : (alvoMinutos > 360 ? almocoPadraoSeg : 0))
          : 0;
        // Se já trabalhou parte, podemos projetar a partir do que falta trabalhar a partir de agora (quando em andamento)
        if (isHoje && emAndamento) {
          const faltaSeg = alvoSeg - segundosTrabalhados;
          const faltaAlmoco = (!jaAlmocou && segundosAlmoco === 0 && alvoMinutos > 360) ? almocoPadraoSeg : 0;
          return this.segundosParaHora(agoraSeg + faltaSeg + faltaAlmoco, false);
        }
        return this.segundosParaHora(primeiraEntradaSeg + alvoSeg + almocoSeg, false);
      };

      if (metaMinutos > 0) {
        previsaoSaidaMeta = calcHoraSaida(metaMinutos, true);
      }
      previsaoSaida8h = calcHoraSaida(480, true);
      previsaoSaida9h = calcHoraSaida(540, true);
    }

    // Verifica se trabalhou na sexta após as 12h
    let minutosSextaApos12h = 0;
    if (isSexta && temMarcacao) {
      const meioDiaSeg = 12 * 3600;
      for (const inter of intervalosTrabalho) {
        if (inter.fim > meioDiaSeg) {
          const ini = Math.max(inter.inicio, meioDiaSeg);
          minutosSextaApos12h += (inter.fim - ini) / 60;
        }
      }
    }

    // Próxima batida sugerida
    let proximaBatidaSugerida = 'ENTRADA';
    if (ordenadas.length > 0) {
      const ultima = ordenadas[ordenadas.length - 1].tipo;
      if (ultima === 'ENTRADA') {
        // Na sexta de 4h (sair 12h), após ENTRADA geralmente é SAIDA às 12h; nos outros dias é ALMOCO_INICIO
        proximaBatidaSugerida = (isSexta && metaMinutos <= 240) ? 'SAIDA' : 'ALMOCO_INICIO';
      } else if (ultima === 'ALMOCO_INICIO' || ultima === 'PAUSA_INICIO') {
        proximaBatidaSugerida = 'ALMOCO_FIM';
      } else if (ultima === 'ALMOCO_FIM' || ultima === 'PAUSA_FIM') {
        proximaBatidaSugerida = 'SAIDA';
      } else if (ultima === 'SAIDA') {
        proximaBatidaSugerida = 'ENTRADA';
      }
    }

    return {
      data: dataStr,
      nomeDia: this.getNomeDiaSemana(dataStr),
      nomeDiaCurto: this.getNomeDiaSemana(dataStr, true),
      diaSemana,
      isHoje,
      isSexta,
      tipoDia,
      observacaoDia: diaEspecial ? diaEspecial.observacao : '',
      marcacoes: ordenadas,
      temMarcacao,
      contabilizarNoBanco,
      emAndamento,
      emAlmoco,
      segundosTrabalhados,
      minutosTrabalhados,
      segundosAlmoco,
      minutosAlmoco,
      metaMinutos,
      saldoMinutos,
      saldoSegundos,
      previsaoSaidaMeta,
      previsaoSaida8h,
      previsaoSaida9h,
      minutosSextaApos12h,
      proximaBatidaSugerida
    };
  },

  // ==================== RESUMO SEMANAL & PAINEL SEXTA 12H ====================
  calcularResumoSemana(dataRefStr, todasMarcacoes, diasEspeciaisMap, config, agoraDate = new Date()) {
    const limites = this.getLimitesSemana(dataRefStr);
    const porData = {};
    for (const m of todasMarcacoes) {
      if (!porData[m.data]) porData[m.data] = [];
      porData[m.data].push(m);
    }

    const resumosDias = limites.dias.map(d =>
      this.calcularResumoDia(d, porData[d] || [], config, diasEspeciaisMap[d] || null, agoraDate)
    );

    let minutosTrabalhadosSemana = 0;
    let minutosMetaSemanaAtiva = 0;
    let saldoMinutosSemana = 0;
    let minutosSegAQui = 0;
    let extraSegAQuiParaSexta = 0; // Quantos minutos além de 8h/dia foram feitos de Seg a Qui

    for (const r of resumosDias) {
      minutosTrabalhadosSemana += r.minutosTrabalhados;
      if (r.contabilizarNoBanco) {
        minutosMetaSemanaAtiva += r.metaMinutos;
        saldoMinutosSemana += r.saldoMinutos;
      }
      if (r.diaSemana >= 1 && r.diaSemana <= 4) {
        minutosSegAQui += r.minutosTrabalhados;
        if (r.temMarcacao) {
          extraSegAQuiParaSexta += Math.max(0, r.minutosTrabalhados - 480);
        }
      }
    }

    const resumoSexta = resumosDias[4]; // índice 4 = Sexta-feira
    // Para sair às 12h na sexta cumprindo 40h semanais: precisa de 36h (2160 min) de Seg a Qui + 4h (240 min) na Sexta
    const metaSegAQuiParaSexta12h = 2160; // 36h
    const faltaSegAQuiMin = Math.max(0, metaSegAQuiParaSexta12h - minutosSegAQui);
    const percentualPlanoSexta12h = Math.min(100, Math.round((minutosSegAQui / metaSegAQuiParaSexta12h) * 100));

    return {
      inicio: limites.inicio,
      fim: limites.fim,
      sexta: limites.sexta,
      resumosDias,
      resumoSexta,
      minutosTrabalhadosSemana,
      minutosMetaPadrao40h: Number(config.meta_semanal_min || 2400),
      minutosMetaSemanaAtiva,
      saldoMinutosSemana,
      minutosSegAQui,
      metaSegAQuiParaSexta12h,
      faltaSegAQuiMin,
      percentualPlanoSexta12h,
      extraSegAQuiParaSexta
    };
  },

  // ==================== RESUMO MENSAL ====================
  calcularResumoMes(anoMesStr, todasMarcacoes, diasEspeciaisMap, config, agoraDate = new Date()) {
    // anoMesStr = 'YYYY-MM'
    const [ano, mes] = anoMesStr.split('-').map(Number);
    const ultimoDia = new Date(ano, mes, 0).getDate();

    const porData = {};
    for (const m of todasMarcacoes) {
      if (m.data.startsWith(anoMesStr)) {
        if (!porData[m.data]) porData[m.data] = [];
        porData[m.data].push(m);
      }
    }

    const resumosDias = [];
    let minutosTrabalhadosMes = 0;
    let minutosMetaMesContabilizado = 0;
    let minutosMetaTotalDiasUteisMes = 0;
    let saldoMinutosMes = 0;
    let diasTrabalhadosCount = 0;
    let sextasApos12hCount = 0;
    let sextasCompensadasCount = 0;

    for (let d = 1; d <= ultimoDia; d++) {
      const dataStr = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const r = this.calcularResumoDia(dataStr, porData[dataStr] || [], config, diasEspeciaisMap[dataStr] || null, agoraDate);
      resumosDias.push(r);

      if (r.diaSemana >= 1 && r.diaSemana <= 5 && r.tipoDia !== 'FERIADO') {
        minutosMetaTotalDiasUteisMes += r.metaMinutos;
      }

      if (r.temMarcacao) {
        diasTrabalhadosCount++;
      }
      if (r.isSexta && r.minutosSextaApos12h >= 30) {
        sextasApos12hCount++;
      }
      if (r.tipoDia === 'SEXTA_COMPENSADA_FOLGA') {
        sextasCompensadasCount++;
      }

      minutosTrabalhadosMes += r.minutosTrabalhados;
      if (r.contabilizarNoBanco) {
        minutosMetaMesContabilizado += r.metaMinutos;
        saldoMinutosMes += r.saldoMinutos;
      }
    }

    return {
      anoMes: anoMesStr,
      nomeMesAno: `${this.MESES[mes - 1]} de ${ano}`,
      resumosDias,
      diasTrabalhadosCount,
      minutosTrabalhadosMes,
      minutosMetaMesContabilizado,
      minutosMetaTotalDiasUteisMes,
      saldoMinutosMes,
      sextasApos12hCount,
      sextasCompensadasCount
    };
  },

  // ==================== SALDO GLOBAL DO BANCO DE HORAS & SEXTAS COMPENSÁVEIS ====================
  calcularBancoDeHorasGlobal(todasMarcacoes, diasEspeciaisMap, config, agoraDate = new Date()) {
    const datasConjunto = new Set();
    for (const m of todasMarcacoes) datasConjunto.add(m.data);
    for (const d of Object.keys(diasEspeciaisMap)) datasConjunto.add(d);

    const datasOrdenadas = Array.from(datasConjunto).sort();
    const porData = {};
    for (const m of todasMarcacoes) {
      if (!porData[m.data]) porData[m.data] = [];
      porData[m.data].push(m);
    }

    const saldoInicialMin = Number(config.saldo_inicial_min || 0);
    let saldoAcumuladoMin = saldoInicialMin;
    let totalTrabalhadoMin = 0;
    let totalMetaContabilizadaMin = 0;

    const historicoSextasExtras = [];
    const historicoSextasFolgadas = [];
    const evolucaoDiaria = [];

    for (const dataStr of datasOrdenadas) {
      const r = this.calcularResumoDia(dataStr, porData[dataStr] || [], config, diasEspeciaisMap[dataStr] || null, agoraDate);
      if (r.contabilizarNoBanco) {
        saldoAcumuladoMin += r.saldoMinutos;
        totalTrabalhadoMin += r.minutosTrabalhados;
        totalMetaContabilizadaMin += r.metaMinutos;
        evolucaoDiaria.push({
          data: dataStr,
          saldoDiaMin: r.saldoMinutos,
          saldoAcumuladoMin,
          trabalhadoMin: r.minutosTrabalhados,
          metaMin: r.metaMinutos
        });
      }

      if (r.isSexta && r.minutosSextaApos12h >= 15) {
        historicoSextasExtras.push({
          data: dataStr,
          trabalhadoTotalMin: r.minutosTrabalhados,
          apos12hMin: r.minutosSextaApos12h,
          saldoGeradoMin: r.saldoMinutos,
          observacao: r.observacaoDia
        });
      }

      if (r.tipoDia === 'SEXTA_COMPENSADA_FOLGA' || r.tipoDia === 'FOLGA_BANCO') {
        historicoSextasFolgadas.push({
          data: dataStr,
          tipoDia: r.tipoDia,
          horasDescontadasMin: Math.abs(r.saldoMinutos),
          observacao: r.observacaoDia
        });
      }
    }

    // Quantas sextas-feiras de folga (de 4h no modo SEXTA_12H ou 8h para um dia completo) cabem no saldo atual?
    const custoSextaMin = Number(config.meta_sexta_min || 240); // 4h (240 min) para sexta no plano 9h/4h
    const sextasLivresDisponiveis = saldoAcumuladoMin > 0
      ? Math.floor((saldoAcumuladoMin / custoSextaMin) * 10) / 10
      : 0;
    const diasInteiros8hDisponiveis = saldoAcumuladoMin > 0
      ? Math.floor((saldoAcumuladoMin / 480) * 10) / 10
      : 0;

    return {
      saldoInicialMin,
      saldoAcumuladoMin,
      totalTrabalhadoMin,
      totalMetaContabilizadaMin,
      custoSextaMin,
      sextasLivresDisponiveis,
      diasInteiros8hDisponiveis,
      historicoSextasExtras,
      historicoSextasFolgadas,
      evolucaoDiaria
    };
  }
};

window.PontoCalculations = PontoCalculations;
