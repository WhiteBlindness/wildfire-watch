import type { Dictionary } from "./types";

// European Portuguese (PT-PT), Acordo Ortográfico de 1990. Not Brazilian
// Portuguese: no gerund for continuous actions, "estar a + infinitivo" where
// applicable, established EP vocabulary (deteção, não "detecção").
const pt: Dictionary = {
  topBar: {
    themeToggleLabel: "Alternar entre modo claro e escuro",
    languageToggleLabel: "Alternar idioma",
  },
  legend: {
    title: "Severidade",
    low: "Baixa",
    moderate: "Moderada",
    high: "Elevada",
    extreme: "Extrema",
  },
  overview: {
    title: "Visão global",
    subtitle: "Todos os focos atualmente monitorizados",
    metricFoci: "Focos monitorizados",
    metricMaxFrp: "Energia radiativa máxima",
    metricArea: "Área global estimada",
    hint: "Selecione um foco no mapa para ver os detalhes individuais de cada incêndio.",
  },
  status: {
    active: "Ativo",
    contained: "Dominado",
    extinguished: "Extinto",
  },
  fireDetail: {
    closeLabel: "Fechar painel",
    backToGlobalMap: "Voltar ao mapa global",
    severityLabel: "Severidade",
    areaLabel: "Área ardida",
    startLabel: "Início",
    containmentEtaLabel: "Contenção prevista",
    containedAtLabel: "Contido em",
    windLabel: "Vento",
    forcesTitle: "Meios no terreno",
    firefightersLabel: "Bombeiros",
    vehiclesLabel: "Veículos",
    planesLabel: "Aviões",
    helicoptersLabel: "Helicópteros",
    aidActive: "Ajuda internacional ativa",
    aidRequested: "Ajuda internacional solicitada",
    evolutionTitle: "Evolução da área ardida",
    provenanceNote:
      "Fonte: deteções de satélite ({source}). Os meios no terreno, o vento e o histórico não são observáveis a partir de deteções térmicas, por isso não são apresentados.",
  },
  ad: {
    label: "Publicidade",
    ariaLabel: "Espaço publicitário",
  },
  chart: {
    timeLabel: "Hora",
    personnelLabel: "Efetivos",
  },
  intensityChart: {
    // Sentence case, no anglicism ("Top" avoided per the PT-PT style rules).
    title: "Principais focos por intensidade",
    subtitle: "Complexos ativos mais intensos, por energia radiativa máxima",
    yAxisLabel: "Energia radiativa (MW)",
    tooltipFrpLabel: "Energia radiativa máxima",
    tooltipDetectionsLabel: "Deteções",
    empty: "Sem dados de energia radiativa disponíveis para esta fonte.",
  },
};

export default pt;
