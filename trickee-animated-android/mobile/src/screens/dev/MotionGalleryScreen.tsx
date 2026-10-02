import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming } from "react-native-reanimated";
import { TrickeeLogoAnimated } from "../../components/logo/TrickeeLogoAnimated";
import { motionColors, motionDurations } from "../../motion/tokens";
import inventory from "../../motion/webInventory.json";
import { fontFamily } from "../../theme/typography";

const REVIEWED_KEY = "trickee.motion.sourceReviewed.v1";
const LOGO_REST_PROGRESS = motionDurations.introResolved / motionDurations.introTotal;
type Entry = (typeof inventory)[number];

export default function MotionGalleryScreen({ navigation }: { navigation: any }) {
  const { width } = useWindowDimensions();
  const progress = useSharedValue(LOGO_REST_PROGRESS);
  const railWidth = useSharedValue(1);
  const [slow, setSlow] = useState(false);
  const [reducedPreview, setReducedPreview] = useState(false);
  const [showFps, setShowFps] = useState(false);
  const [fps, setFps] = useState(0);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "logo">("all");
  const frameCount = useSharedValue(0);
  const frameTime = useSharedValue(0);

  useEffect(() => {
    AsyncStorage.getItem(REVIEWED_KEY)
      .then((value) => { if (value) setReviewed(JSON.parse(value)); })
      .catch(() => undefined);
    return () => cancelAnimation(progress);
  }, [progress]);

  const fpsCallback = useFrameCallback((frame) => {
    if (!showFps || !frame.timeSincePreviousFrame) return;
    frameCount.value += 1;
    frameTime.value += frame.timeSincePreviousFrame;
    if (frameCount.value >= 30) {
      runOnJS(setFps)(Math.round(1000 / (frameTime.value / frameCount.value)));
      frameCount.value = 0;
      frameTime.value = 0;
    }
  }, false);

  useEffect(() => {
    fpsCallback.setActive(showFps);
    if (!showFps) setFps(0);
  }, [fpsCallback, showFps]);

  const scrub = useMemo(() => {
    const pan = Gesture.Pan().onBegin((event) => { cancelAnimation(progress); progress.value = Math.max(0, Math.min(1, event.x / railWidth.value)); })
      .onUpdate((event) => { progress.value = Math.max(0, Math.min(1, event.x / railWidth.value)); });
    const tap = Gesture.Tap().onEnd((event) => { cancelAnimation(progress); progress.value = Math.max(0, Math.min(1, event.x / railWidth.value)); });
    return Gesture.Simultaneous(pan, tap);
  }, [progress, railWidth]);

  const fillStyle = useAnimatedStyle(() => ({ width: railWidth.value * progress.value }));
  const replay = useCallback(() => {
    cancelAnimation(progress);
    progress.value = 0;
    progress.value = withTiming(1, { duration: motionDurations.introTotal * (slow ? 4 : 1), easing: Easing.linear }, (finished) => {
      if (finished) progress.value = LOGO_REST_PROGRESS;
    });
  }, [progress, slow]);
  const step = useCallback((direction: number) => {
    cancelAnimation(progress);
    progress.value = Math.max(0, Math.min(1, progress.value + direction * 100 / motionDurations.introTotal));
  }, [progress]);
  const toggleReviewed = useCallback((id: string) => {
    setReviewed((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      AsyncStorage.setItem(REVIEWED_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const entries = filter === "logo" ? inventory.filter((entry) => entry.category === "logo") : inventory;
  const renderEntry = useCallback(({ item }: { item: Entry }) => (
    <View style={styles.entry}>
      <View style={styles.entryTop}><Text style={styles.id}>{item.id}</Text><Text style={styles.category}>{item.category}</Text></View>
      <Text style={styles.expression} numberOfLines={2}>{item.excerpt}</Text>
      <Text style={styles.source}>{item.file}:{item.line}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Mark ${item.id} source reviewed`} onPress={() => toggleReviewed(item.id)}>
        <Text style={styles.review}>{reviewed.includes(item.id) ? "✓ SOURCE REVIEWED" : "MARK SOURCE REVIEWED"}</Text>
      </Pressable>
    </View>
  ), [reviewed, toggleReviewed]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}><Text style={styles.back}>← BACK</Text></Pressable>
        <Text style={styles.kicker}>MOTION LAB / DEVELOPMENT</Text>
        <Text style={styles.title}>Motion Gallery</Text>
        <Text style={styles.summary}>{inventory.length} web source occurrences · {reviewed.length} reviewed</Text>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderEntry}
        initialNumToRender={8}
        windowSize={5}
        ListHeaderComponent={<View style={styles.playground}>
          <View style={styles.specimen}>
            <Text style={styles.specimenKicker}>TYPOGRAPHY / REFERENCE</Text>
            <Text style={styles.specimenHeading}>Signal becomes direction.</Text>
            <Text style={styles.specimenBody}>Manrope carries every journey, metric, and decision with clarity at a glance.</Text>
            <Text style={styles.specimenTechnical}>MICROMOTION / 01 — MICHROMA</Text>
          </View>
          <Text style={styles.sectionTitle}>LOGO PLAYGROUND</Text>
          <View style={styles.logoStage}><TrickeeLogoAnimated size={Math.min(width * 0.72, 290)} mode="playground" progress={progress} reducedMotionPreview={reducedPreview} /></View>
          <GestureDetector gesture={scrub}>
            <View style={styles.rail} onLayout={(event) => { railWidth.value = event.nativeEvent.layout.width; }}>
              <Animated.View style={[styles.railFill, fillStyle]} />
            </View>
          </GestureDetector>
          <View style={styles.timeLabels}><Text style={styles.source}>0 MS</Text><Text style={styles.source}>5050 MS</Text></View>
          <View style={styles.controls}>
            <Pressable style={styles.control} onPress={replay}><Text style={styles.controlText}>REPLAY</Text></Pressable>
            <Pressable style={styles.control} onPress={() => step(-1)}><Text style={styles.controlText}>−100 MS</Text></Pressable>
            <Pressable style={styles.control} onPress={() => step(1)}><Text style={styles.controlText}>+100 MS</Text></Pressable>
            <Pressable style={styles.control} onPress={() => setSlow((value) => !value)}><Text style={styles.controlText}>{slow ? "1× SPEED" : "0.25× SPEED"}</Text></Pressable>
            <Pressable style={styles.control} onPress={() => setReducedPreview((value) => !value)}><Text style={styles.controlText}>{reducedPreview ? "FULL MOTION" : "REDUCED MOTION"}</Text></Pressable>
            <Pressable style={styles.control} onPress={() => setShowFps((value) => !value)}><Text style={styles.controlText}>{showFps ? `${fps} FPS` : "SHOW FPS"}</Text></Pressable>
          </View>
          <View style={styles.filterRow}>
            <Pressable onPress={() => setFilter("all")}><Text style={[styles.filter, filter === "all" && styles.filterActive]}>ALL SOURCE</Text></Pressable>
            <Pressable onPress={() => setFilter("logo")}><Text style={[styles.filter, filter === "logo" && styles.filterActive]}>LOGO</Text></Pressable>
          </View>
        </View>}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: motionColors.ink },
  header: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "rgba(72,223,244,0.2)" },
  back: { color: motionColors.cyan, fontFamily: fontFamily.technical, fontSize: 9, marginBottom: 24 },
  kicker: { color: motionColors.yellow, fontFamily: fontFamily.technical, fontSize: 8, letterSpacing: 1.4 },
  title: { color: motionColors.text, fontFamily: fontFamily.headingBold, fontSize: 34, marginTop: 6 },
  summary: { color: "#8FA3AA", fontFamily: fontFamily.body, fontSize: 12, marginTop: 4 },
  listContent: { padding: 18, paddingBottom: 70 },
  playground: { paddingBottom: 28 },
  specimen: { padding: 20, marginBottom: 28, borderWidth: 1, borderColor: "rgba(72,223,244,0.2)", borderRadius: 16, backgroundColor: motionColors.panel },
  specimenKicker: { color: motionColors.yellow, fontFamily: fontFamily.technical, fontSize: 8, letterSpacing: 1.2 },
  specimenHeading: { color: motionColors.text, fontFamily: fontFamily.headingBold, fontSize: 32, lineHeight: 34, letterSpacing: -1.2, marginTop: 16 },
  specimenBody: { color: motionColors.text, fontFamily: fontFamily.body, fontSize: 16, lineHeight: 27, marginTop: 12 },
  specimenTechnical: { color: motionColors.yellow, fontFamily: fontFamily.technical, fontSize: 9, letterSpacing: 1.2, marginTop: 18 },
  sectionTitle: { color: motionColors.yellow, fontFamily: fontFamily.technical, fontSize: 9, letterSpacing: 1.3 },
  logoStage: { height: 345, alignItems: "center", justifyContent: "center" },
  rail: { height: 32, justifyContent: "center", borderRadius: 16, backgroundColor: "#10202A", overflow: "hidden" },
  railFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: motionColors.yellow, opacity: 0.7 },
  timeLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  control: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(72,223,244,0.35)", borderRadius: 8, backgroundColor: motionColors.panel },
  controlText: { color: motionColors.text, fontFamily: fontFamily.technical, fontSize: 8 },
  filterRow: { flexDirection: "row", gap: 20, marginTop: 30, marginBottom: 14 },
  filter: { color: "#8FA3AA", fontFamily: fontFamily.technical, fontSize: 9 },
  filterActive: { color: motionColors.yellow },
  entry: { padding: 15, marginBottom: 10, borderWidth: 1, borderColor: "rgba(184,222,229,0.16)", borderRadius: 14, backgroundColor: motionColors.panel },
  entryTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  id: { color: motionColors.yellow, fontFamily: fontFamily.technical, fontSize: 10 },
  category: { color: motionColors.cyan, fontFamily: fontFamily.technical, fontSize: 8 },
  expression: { color: motionColors.text, fontFamily: fontFamily.body, fontSize: 12, marginTop: 10 },
  source: { color: "#8FA3AA", fontFamily: fontFamily.body, fontSize: 10, marginTop: 7 },
  review: { color: motionColors.yellow, fontFamily: fontFamily.technical, fontSize: 8, marginTop: 14 },
});
