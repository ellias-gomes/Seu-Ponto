# Seu Ponto - Sistema de Marcação, Compensação & Auditoria Forense

Sistema completo de controle de ponto e banco de horas projetado especificamente para rodar em **Windows 11 corporativo**, com **VPN ativa**, **sem necessidade de privilégios de Administrador** e imune a bloqueios empresariais.

---

## 🎯 Regras de Negócio e Acordos Atendidos

1. **Jornada Padrão e Compensação da Sexta 12h**:
   * **Segunda a Quinta**: Meta de **9h/dia** (36 horas no total).
   * **Sexta-Feira**: Meta de apenas **4h** (encerra às 12h, fechando as 40h semanais).
   * **Trabalho após as 12h na Sexta**: Todo minuto trabalhado além das 12h entra diretamente como **crédito no Banco de Horas**.
   * **Compensação com Sextas Livres**: Ao acumular **4h no saldo positivo**, o sistema destaca que você já tem direito a folgar **1 sexta-feira inteira**.

2. **Marcações e Flexibilidade**:
   * **Em Tempo Real**: Botões rápidos de 1-clique para Entrada, Almoço (Saída e Retorno) e Saída Final com relógio vivo segundo a segundo.
   * **Ajuste Manual / Retroativo**: Formulário para lançar batidas esquecidas com justificativa obrigatória e anexo de comprovante.
   * **Previsão de Saída Inteligente**: O sistema calcula automaticamente o horário previsto de saída para cumprir a meta do dia (considerando se é dia de 9h, 8h ou 4h).

3. **Comprovação Forense & Evidências de Trabalho**:
   * **Print da Tela**: Captura de tela com carimbo visual técnico (data, hora, IP, modo e assinatura).
   * **Sessão 1-Clique Contínua**: Permite ativar o compartilhamento contínuo de tela para tirar prints instantaneamente a cada batida sem exibir caixas de confirmação repetidas.
   * **Colar da Área de Transferência**: Suporte a `Win + Shift + S` e `Ctrl + V` para colar capturas diretamente no sistema.
   * **Extração de IP e VPN**: Coleta IP público/VPN, provedor/ISP, ASN, cidade/UF e IP local da interface.
   * **Assinatura SHA-256 e Elo de Custódia**: Cada marcação gera um hash criptográfico amarrado ao registro anterior, garantindo que o histórico não foi adulterado.

4. **Resumos e Visões**:
   * **Hoje**: Relógio ao vivo, progresso do expediente, contadores e lista de batidas do dia.
   * **Diário**: Espelho detalhado do dia, classificação (normal, folga compensada, feriado, atestado) e saldo diário.
   * **Semanal**: Visão de Segunda a Domingo, somatório das 40h e histórico dedicado de sextas extras vs sextas folgadas.
   * **Mensal**: Espelho de ponto completo do mês com opção de impressão/PDF.
   * **Galeria de Evidências**: Mural com todas as imagens e botão para gerar dossiê em PDF.
   * **Banco SQLite**: Exportação de arquivo `.db`, planilhas `.csv`, `.json` e console SQL integrado.

---

## 🚀 Como Executar

O sistema funciona de forma idêntica tanto no **Windows 11** quanto no **Pop!_OS / Linux**:

### No Pop!_OS / Linux (Seu Computador Pessoal)
Abra o terminal na pasta do projeto e execute:
```bash
./iniciar_ponto.sh
```
*(ou se preferir, `python3 servidor_local.py`)*. O servidor iniciará em `http://127.0.0.1:8000` e abrirá seu navegador padrão automaticamente.

### No Windows 11 (Notebook da Empresa)
Não requer privilégios de Administrador nem instalação de bibliotecas externas:
1. Dê dois cliques no arquivo **`iniciar_ponto.bat`** (ou execute `python servidor_local.py`).
2. O sistema abrirá diretamente no Microsoft Edge ou Chrome em `http://127.0.0.1:8000`.

### Execução Direta no Navegador (Sem Python em qualquer sistema)
Graças ao SQLite WASM offline:
* Basta abrir o arquivo **`index.html`** diretamente em qualquer navegador moderno.

---

## 🔒 Segurança e Privacidade
* **100% Local**: Os dados e prints ficam exclusivamente na sua máquina (`localhost` / banco SQLite).
* **Sem dependência de servidores externos**: Funciona mesmo desconectado da internet.
* **Backup Fácil**: Na aba *SQLite & Configurações*, clique em **"Baixar Banco de Dados Físico (.db)"** para guardar uma cópia do seu banco de horas.
