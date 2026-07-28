import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";

const STEPS = [
  {
    icon: "tire",
    label: "Rolling resistance",
    formula: "Fᵣᵣ = Cᵣᵣ × m × g",
    detail: "Tyre and road deformation opposing forward motion",
  },
  {
    icon: "image-filter-hdr",
    label: "Grade resistance",
    formula: "Fgrade = m × g × sin(θ)",
    detail: "Gravity component calculated from GPS road grade",
  },
  {
    icon: "weather-windy",
    label: "Aerodynamic drag",
    formula: "Fdrag = ½ × ρ × Cᴅ × A × v²",
    detail: "Air resistance grows with the square of GPS-derived speed",
  },
  {
    icon: "speedometer",
    label: "Acceleration force",
    formula: "Facc = m × a",
    detail: "Inertial demand from GPS-derived acceleration",
  },
  {
    icon: "sigma",
    label: "Total traction force",
    formula: "Ftraction = Fᵣᵣ + Fgrade + Fdrag + Facc",
    detail: "All longitudinal road-load forces combined",
  },
  {
    icon: "flash-outline",
    label: "Traction power",
    formula: "Ptraction = Ftraction × v",
    detail: "Mechanical power required at the driven wheels",
  },
  {
    icon: "battery-charging-outline",
    label: "Battery power",
    formula: "Pbattery = Ptraction / η + Paux",
    detail: "Drivetrain losses and auxiliary electrical loads included",
  },
] as const;

const valueOf = (field: any): number | undefined => {
  const value = typeof field === "object" ? field?.value : field;
  return typeof value === "number" ? value : undefined;
};

const CalculationOverlay: React.FC<{
  visible: boolean;
  result?: any;
  error?: string | null;
  onFinished: () => void;
}> = ({ visible, result, error, onFinished }) => {
  const [step, setStep] = useState(0);
  const [minimumComplete, setMinimumComplete] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const cardIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      return;
    }
    setStep(0);
    setMinimumComplete(false);
    progress.setValue(0);
    cardIn.setValue(0);
    const stepTimer = setInterval(
      () => setStep((value) => Math.min(value + 1, STEPS.length - 1)),
      500
    );
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: 4000,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      ),
    ]).start();
    Animated.spring(cardIn, {
      toValue: 1,
      damping: 14,
      stiffness: 150,
      useNativeDriver: true,
    }).start();
    const completionTimer = setTimeout(() => setMinimumComplete(true), 4000);
    return () => {
      clearInterval(stepTimer);
      clearTimeout(completionTimer);
      pulse.stopAnimation();
    };
  }, [visible, progress, pulse, cardIn]);

  const prediction = result?.prediction;
  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["2%", "100%"],
  });
  const glowScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.16],
  });
  const values = useMemo(() => {
    const calculation = result?.calculation;
    const measuredWhKm = valueOf(calculation?.measured_wh_per_km);
    const measuredEnergy = valueOf(calculation?.measured_energy_wh);
    const measuredSoc = valueOf(calculation?.measured_soc_used_pct);
    const whKm = measuredWhKm ?? valueOf(prediction?.wh_per_km);
    const energy = measuredEnergy ?? valueOf(prediction?.route_energy_wh);
    const range = valueOf(prediction?.range_km);
    const soc = measuredSoc ?? valueOf(prediction?.soc_consumed_pct);
    const distance = valueOf(calculation?.distance_km);
    const samples = valueOf(calculation?.gps_sample_count);
    const confidence =
      prediction?.confidence || prediction?.wh_per_km?.confidence || "low";
    const source =
      prediction?.source || prediction?.wh_per_km?.source || "physics_baseline";
    return {
      whKm,
      energy,
      range,
      soc,
      distance,
      samples,
      confidence,
      source,
      measured: measuredWhKm != null,
    };
  }, [prediction, result]);

  const unavailable = result?.calculation_status === "insufficient_gps";
  const displayError =
    error ||
    (unavailable
      ? "Trip saved, but there were not enough valid GPS points to calculate energy. Keep location enabled throughout the next trip."
      : null);
  const showResult = Boolean(result && !unavailable && minimumComplete);
  const showError = Boolean(displayError && minimumComplete);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.workspace,
            {
              opacity: cardIn,
              transform: [
                {
                  translateY: cardIn.interpolate({
                    inputRange: [0, 1],
                    outputRange: [36, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.topRow}>
            <View style={styles.labMark}>
              <Icon name="atom" size={17} color="#FFFFFF" />
            </View>
            <View style={styles.topCopy}>
              <Text style={styles.eyebrow}>TRICKEE PHYSICS LAB</Text>
              <Text style={styles.labTitle}>
                {showResult
                  ? "Energy model complete"
                  : "Building your estimate"}
              </Text>
            </View>
            <Text style={styles.counter}>0{showResult ? 7 : step + 1}/07</Text>
          </View>

          {showError ? (
            <View style={styles.center}>
              <View style={[styles.resultIcon, styles.errorIcon]}>
                <Icon name="alert-outline" size={31} color="#FFFFFF" />
              </View>
              <Text style={styles.resultTitle}>
                {unavailable ? "Trip saved" : "Calculation interrupted"}
              </Text>
              <Text style={styles.resultMeta}>{displayError}</Text>
              <TouchableOpacity style={styles.doneButton} onPress={onFinished}>
                <Text style={styles.doneText}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : showResult ? (
            <View style={styles.resultArea}>
              <View style={styles.center}>
                <View style={styles.resultIcon}>
                  <Icon name="check-bold" size={29} color="#FFFFFF" />
                </View>
                <Text style={styles.resultTitle}>Your energy fingerprint</Text>
                <Text style={styles.resultMeta}>
                  {values.measured
                    ? "Measured from GPS distance and dashboard SOC change"
                    : "Estimated from GPS-derived motion and vehicle physics"}
                </Text>
              </View>
              <View style={styles.metricHero}>
                <Text style={styles.metricValue}>
                  {values.whKm?.toFixed(1) ?? "—"}
                </Text>
                <Text style={styles.metricUnit}>
                  Wh / km {values.measured ? "SOC-CALIBRATED" : "GPS ESTIMATE"}
                </Text>
                <View style={styles.energyBars}>
                  {[18, 29, 42, 56, 40, 67, 52, 78, 64, 88].map((height, i) => (
                    <View
                      key={`${height}-${i}`}
                      style={[styles.energyBar, { height }]}
                    />
                  ))}
                </View>
              </View>
              <View style={styles.resultGrid}>
                <View style={styles.resultCell}>
                  <Text style={styles.cellLabel}>GPS DISTANCE</Text>
                  <Text style={styles.cellValue}>
                    {values.distance?.toFixed(2) ?? "—"} km
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.resultCell}>
                  <Text style={styles.cellLabel}>SOC USED</Text>
                  <Text style={styles.cellValue}>
                    {values.soc?.toFixed(1) ?? "—"}%
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.resultCell}>
                  <Text style={styles.cellLabel}>TRIP ENERGY</Text>
                  <Text style={styles.cellValue}>
                    {values.energy?.toFixed(0) ?? "—"} Wh
                  </Text>
                </View>
              </View>
              <Text style={styles.provenance}>
                {values.source.replaceAll("_", " ")} · {values.confidence}{" "}
                confidence · {values.samples?.toFixed(0) ?? 0} GPS samples
                {values.range != null
                  ? ` · ${values.range.toFixed(1)} km estimated range`
                  : ""}
              </Text>
              <View style={styles.mlBadge}>
                <Icon name="brain" size={15} color="#17375E" />
                <Text style={styles.mlText}>
                  GPS quality checks → physics baseline → SOC cross-check
                </Text>
              </View>
              <TouchableOpacity style={styles.doneButton} onPress={onFinished}>
                <Text style={styles.doneText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.visualizer}>
                <View style={styles.axisY} />
                <View style={styles.axisX} />
                {[0, 1, 2, 3, 4].map((index) => (
                  <View
                    key={index}
                    style={[
                      styles.wavePoint,
                      {
                        left: `${8 + index * 20}%`,
                        bottom: 18 + [12, 55, 29, 70, 45][index],
                      },
                    ]}
                  />
                ))}
                <View style={[styles.waveLine, styles.lineOne]} />
                <View style={[styles.waveLine, styles.lineTwo]} />
                <View style={[styles.waveLine, styles.lineThree]} />
                <View style={[styles.waveLine, styles.lineFour]} />
                <Animated.View
                  style={[
                    styles.scanner,
                    { transform: [{ scale: glowScale }] },
                  ]}
                >
                  <Icon name={STEPS[step].icon} size={27} color="#FFFFFF" />
                </Animated.View>
                <Text style={styles.axisLabel}>ENERGY / DISTANCE</Text>
              </View>

              <Animated.View
                key={STEPS[step].label}
                style={[styles.formulaCard, { opacity: cardIn }]}
              >
                <View style={styles.formulaHeader}>
                  <Text style={styles.stepPill}>STAGE {step + 1}</Text>
                  <Text style={styles.formulaLabel}>{STEPS[step].label}</Text>
                </View>
                <Text style={styles.formula}>{STEPS[step].formula}</Text>
                <Text style={styles.formulaDetail}>{STEPS[step].detail}</Text>
              </Animated.View>

              <View style={styles.track}>
                <Animated.View style={[styles.fill, { width }]} />
              </View>
              <View style={styles.pipeline}>
                {STEPS.map((item, index) => (
                  <View key={item.label} style={styles.pipelineItem}>
                    <View
                      style={[
                        styles.pipelineDot,
                        index <= step && styles.pipelineDotActive,
                      ]}
                    >
                      {index < step && (
                        <Icon name="check" size={10} color="#FFFFFF" />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.pipelineText,
                        index === step && styles.pipelineTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.flowFooter}>
                <Text style={styles.flowText}>
                  GPS + VEHICLE SPECS → 7 PHYSICS EQUATIONS → SOC CHECK → RESULT
                </Text>
              </View>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    backgroundColor: "rgba(3,8,16,0.76)",
  },
  workspace: {
    width: "100%",
    borderRadius: 30,
    padding: 22,
    backgroundColor: "#F8FAFD",
    shadowColor: "#EAF3FF",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
    elevation: 24,
  },
  topRow: { flexDirection: "row", alignItems: "center" },
  labMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#11213C",
  },
  topCopy: { flex: 1, marginLeft: 11 },
  eyebrow: {
    color: "#738199",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.25,
  },
  labTitle: { color: "#101B30", fontSize: 16, fontWeight: "900", marginTop: 2 },
  counter: { color: "#91A0B5", fontSize: 11, fontWeight: "900" },
  visualizer: {
    height: 150,
    overflow: "hidden",
    borderRadius: 22,
    marginTop: 20,
    backgroundColor: "#EAF0F8",
  },
  axisX: {
    position: "absolute",
    left: 22,
    right: 18,
    bottom: 28,
    height: 1,
    backgroundColor: "#CBD5E2",
  },
  axisY: {
    position: "absolute",
    left: 22,
    top: 17,
    bottom: 28,
    width: 1,
    backgroundColor: "#CBD5E2",
  },
  axisLabel: {
    position: "absolute",
    right: 13,
    bottom: 8,
    color: "#9AA7B8",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  wavePoint: {
    position: "absolute",
    zIndex: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#FFC91F",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  waveLine: {
    position: "absolute",
    height: 3,
    borderRadius: 2,
    backgroundColor: "#FFC91F",
  },
  lineOne: {
    width: "22%",
    left: "10%",
    bottom: 48,
    transform: [{ rotate: "-25deg" }],
  },
  lineTwo: {
    width: "21%",
    left: "29%",
    bottom: 58,
    transform: [{ rotate: "18deg" }],
  },
  lineThree: {
    width: "23%",
    left: "47%",
    bottom: 67,
    transform: [{ rotate: "-27deg" }],
  },
  lineFour: {
    width: "23%",
    left: "66%",
    bottom: 80,
    transform: [{ rotate: "19deg" }],
  },
  scanner: {
    position: "absolute",
    right: 20,
    top: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#15284B",
    shadowColor: "#6A8FC8",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
  },
  formulaCard: {
    borderRadius: 19,
    padding: 17,
    marginTop: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5EAF1",
    shadowColor: "#8FA0B8",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 7,
  },
  formulaHeader: { flexDirection: "row", alignItems: "center" },
  stepPill: {
    overflow: "hidden",
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 4,
    color: "#172845",
    fontSize: 8,
    fontWeight: "900",
    backgroundColor: "#FFD750",
  },
  formulaLabel: {
    color: "#172033",
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 9,
  },
  formula: {
    color: "#13274A",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.35,
    marginTop: 14,
  },
  formulaDetail: {
    color: "#77869B",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 6,
  },
  track: {
    height: 5,
    overflow: "hidden",
    borderRadius: 4,
    marginTop: 20,
    backgroundColor: "#E2E8F0",
  },
  fill: { height: 5, borderRadius: 4, backgroundColor: "#172A4D" },
  pipeline: { marginTop: 16 },
  pipelineItem: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  pipelineDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD4E0",
    backgroundColor: "#FFFFFF",
  },
  pipelineDotActive: { borderColor: "#172A4D", backgroundColor: "#172A4D" },
  pipelineText: { color: "#A1ABBA", fontSize: 10, marginLeft: 9 },
  pipelineTextActive: { color: "#172033", fontWeight: "800" },
  flowFooter: {
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginTop: 7,
    backgroundColor: "#E9EEF5",
  },
  flowText: {
    color: "#617089",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.35,
    textAlign: "center",
  },
  center: { alignItems: "center" },
  resultArea: { marginTop: 22 },
  resultIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17375E",
    shadowColor: "#17375E",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  errorIcon: { backgroundColor: Colors.red },
  resultTitle: {
    color: "#101B30",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 13,
  },
  resultMeta: {
    color: "#7C899B",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 5,
  },
  metricHero: {
    overflow: "hidden",
    borderRadius: 22,
    padding: 20,
    marginTop: 20,
    backgroundColor: "#122441",
  },
  metricValue: { color: "#FFFFFF", fontSize: 40, fontWeight: "900" },
  metricUnit: { color: "#AFC0D8", fontSize: 11, fontWeight: "700" },
  energyBars: {
    position: "absolute",
    right: 14,
    bottom: 16,
    height: 88,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
  },
  energyBar: { width: 5, borderRadius: 3, backgroundColor: "#FFD12C" },
  resultGrid: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    marginTop: 12,
    backgroundColor: "#EDF2F8",
  },
  resultCell: { flex: 1, alignItems: "center" },
  divider: { width: 1, height: 35, backgroundColor: "#D3DCE8" },
  cellLabel: { color: "#8895A7", fontSize: 8, fontWeight: "900" },
  cellValue: {
    color: "#17233A",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 5,
  },
  provenance: {
    color: "#8A96A7",
    fontSize: 9,
    textAlign: "center",
    textTransform: "capitalize",
    marginTop: 11,
  },
  mlBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    backgroundColor: "#E8EFF8",
  },
  mlText: { color: "#42536D", fontSize: 9, fontWeight: "700" },
  doneButton: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 15,
    backgroundColor: "#FFD12C",
  },
  doneText: { color: "#14213A", fontSize: 14, fontWeight: "900" },
});

export default CalculationOverlay;
