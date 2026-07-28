// Canonical dictionary shape — pt.ts is typed against `typeof en`, so a
// missing or mistyped key in either locale is a compile-time error.
const en = {
  topBar: {
    themeToggleLabel: "Toggle light and dark mode",
    languageToggleLabel: "Switch language",
  },
  legend: {
    title: "Severity",
    low: "Low",
    moderate: "Moderate",
    high: "High",
    extreme: "Extreme",
  },
  overview: {
    title: "Global overview",
    subtitle: "All fires currently monitored",
    metricFoci: "Monitored fires",
    metricMaxFrp: "Peak radiative power",
    metricArea: "Estimated global area",
    hint: "Select a fire on the map to see individual details for each incident.",
  },
  status: {
    active: "Active",
    contained: "Contained",
    extinguished: "Extinguished",
  },
  fireDetail: {
    closeLabel: "Close panel",
    backToGlobalMap: "Back to global map",
    severityLabel: "Severity",
    areaLabel: "Burned area",
    startLabel: "Started",
    containmentEtaLabel: "Estimated containment",
    containedAtLabel: "Contained at",
    windLabel: "Wind",
    forcesTitle: "Forces on the ground",
    firefightersLabel: "Firefighters",
    vehiclesLabel: "Vehicles",
    planesLabel: "Planes",
    helicoptersLabel: "Helicopters",
    aidActive: "International aid active",
    aidRequested: "International aid requested",
    evolutionTitle: "Burned area over time",
    provenanceNote:
      "Source: satellite detections ({source}). Ground forces, wind, and history are not observable from thermal detections, so they are not shown.",
  },
  ad: {
    label: "Advertisement",
    ariaLabel: "Advertisement space",
  },
  chart: {
    timeLabel: "Time",
    personnelLabel: "Personnel",
  },
  intensityChart: {
    title: "Top threats by intensity",
    subtitle: "Most intense active complexes, by peak radiative power",
    yAxisLabel: "Radiative power (MW)",
    tooltipFrpLabel: "Peak radiative power",
    tooltipDetectionsLabel: "Detections",
    empty: "No radiative power data available for this source.",
  },
};

export default en;
