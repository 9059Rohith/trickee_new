import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { logoRouteCircle, logoRouteLengths, logoRoutePaths, stageProgress } from "../../motion/logoTimeline";
import { backOut, power2InOut, power2Out, power3Out, sineOut } from "../../motion/easing";
import { motionColors, motionDurations, motionGeometry } from "../../motion/tokens";
import { fontFamily } from "../../theme/typography";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const brandArt = require("../../../assets/logo/trickee_logo.png");

type LogoMode = "splash" | "header" | "loader" | "playground";

export interface TrickeeLogoAnimatedProps {
  size?: number;
  progress?: number | SharedValue<number>;
  mode?: LogoMode;
  speed?: number;
  reducedMotionPreview?: boolean;
  onComplete?: () => void;
}

function rippleFrame(milliseconds: number, index: number) {
  "worklet";
  const enter = sineOut(Math.max(0, Math.min(1, (milliseconds - 650 - index * 350) / 450)));
  const leave = power2Out(Math.max(0, Math.min(1, (milliseconds - 1100 - index * 350) / 1700)));
  return {
    opacity: 0.55 * enter * (1 - leave),
    transform: [{ scale: 0.25 + 0.3 * enter + 0.85 * leave }],
  };
}

export function TrickeeLogoAnimated({
  size = 300,
  progress,
  mode = "splash",
  speed = 1,
  reducedMotionPreview = false,
  onComplete,
}: TrickeeLogoAnimatedProps) {
  const reduced = useReducedMotion() || reducedMotionPreview;
  const time = useSharedValue(0);
  const reducedOpacity = useSharedValue(reduced ? 0 : 1);
  const breathe = useSharedValue(0);
  const externalProgress = typeof progress === "object" ? progress : undefined;
  const displayTime = useDerivedValue(() => externalProgress ? externalProgress.value * motionDurations.introTotal : time.value);

  useEffect(() => {
    cancelAnimation(time);
    cancelAnimation(breathe);
    if (mode === "header") {
      reducedOpacity.value = 1;
      time.value = motionDurations.introResolved;
      if (!reduced) breathe.value = withRepeat(withTiming(1, { duration: 4600, easing: Easing.inOut(Easing.sin) }), -1, true);
      return () => { cancelAnimation(breathe); };
    }
    if (typeof progress === "number") {
      reducedOpacity.value = 1;
      time.value = Math.max(0, Math.min(1, progress)) * motionDurations.introTotal;
      return;
    }
    if (externalProgress) {
      reducedOpacity.value = 1;
      return;
    }
    if (reduced) {
      time.value = motionDurations.introResolved;
      reducedOpacity.value = withTiming(1, { duration: 200 }, (finished) => {
        if (finished && onComplete) runOnJS(onComplete)();
      });
      return () => { cancelAnimation(reducedOpacity); };
    }
    if (mode === "loader") {
      time.value = withRepeat(withTiming(1950, { duration: 1950, easing: Easing.linear }), -1, false);
      return () => { cancelAnimation(time); };
    }
    time.value = 0;
    time.value = withTiming(motionDurations.introTotal, {
      duration: motionDurations.introTotal / Math.max(0.1, speed),
      easing: Easing.linear,
    }, (finished) => {
      if (finished && onComplete) runOnJS(onComplete)();
    });
    return () => { cancelAnimation(time); };
  }, [breathe, externalProgress, mode, onComplete, progress, reduced, reducedOpacity, speed, time]);

  const routeProps1 = useAnimatedProps(() => ({
    strokeDashoffset: logoRouteLengths[0] * (1 - power2InOut(stageProgress(displayTime.value, "route"))),
  }));
  const routeProps2 = useAnimatedProps(() => ({
    strokeDashoffset: logoRouteLengths[1] * (1 - power2InOut(stageProgress(displayTime.value - 160, "route"))),
  }));
  const routeProps3 = useAnimatedProps(() => ({
    strokeDashoffset: logoRouteLengths[2] * (1 - power2InOut(stageProgress(displayTime.value - 320, "route"))),
  }));
  const routeStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : 1 - Math.max(0, Math.min(1, (displayTime.value - 1950) / 650)),
  }));
  const gridStyle = useAnimatedStyle(() => {
    const value = stageProgress(displayTime.value, "grid");
    return {
      opacity: reduced || mode === "header" ? 0 : value * 0.6,
      transform: [{ rotateX: "58deg" }, { scale: 1.12 - 0.12 * value }],
    };
  });
  const rippleOneStyle = useAnimatedStyle(() => reduced || mode === "header"
    ? { opacity: 0, transform: [{ scale: 0.25 }] }
    : rippleFrame(displayTime.value, 0));
  const rippleTwoStyle = useAnimatedStyle(() => reduced || mode === "header"
    ? { opacity: 0, transform: [{ scale: 0.25 }] }
    : rippleFrame(displayTime.value, 1));
  const artStyle = useAnimatedStyle(() => {
    const value = reduced || mode === "header" ? 1 : power3Out(stageProgress(displayTime.value, "art"));
    return {
      opacity: value,
      transform: [
        { translateY: (1 - value) * 9 },
        { scale: motionGeometry.logoImageScaleStart + value * (1 - motionGeometry.logoImageScaleStart) + breathe.value * 0.02 },
      ],
    };
  });
  const orbitStyle = useAnimatedStyle(() => {
    const value = stageProgress(displayTime.value, "orbits");
    return {
      opacity: reduced || mode === "header" ? 0 : value,
      transform: [
        { rotate: `${-65 * (1 - power3Out(value))}deg` },
        { scale: motionGeometry.logoOrbitScaleStart + value * (1 - motionGeometry.logoOrbitScaleStart) },
      ],
    };
  });
  const haloStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : sineOut(stageProgress(displayTime.value, "halo")) * 0.8,
    transform: [{ scale: 0.65 + sineOut(stageProgress(displayTime.value, "halo")) * 0.35 }],
  }));
  const pulseStyle = useAnimatedStyle(() => {
    const enter = backOut(stageProgress(displayTime.value, "pulse"));
    const leave = Math.max(0, Math.min(1, (displayTime.value - 1150) / 900));
    return {
      opacity: reduced ? 0 : enter * (1 - leave),
      transform: [{ scale: 0.1 + enter * 0.9 + leave * 1.5 }],
    };
  });
  const captionStyle = useAnimatedStyle(() => {
    const value = reduced || mode === "header" ? 1 : power3Out(stageProgress(displayTime.value, "caption"));
    return { opacity: value, transform: [{ translateY: (1 - value) * 14 }] };
  });
  const exitStyle = useAnimatedStyle(() => ({
    opacity: mode === "splash" || mode === "playground" ? 1 - power2InOut(stageProgress(displayTime.value, "exit")) : 1,
    transform: [{ translateY: -8 * stageProgress(displayTime.value, "exit") }],
  }));
  const rootStyle = useAnimatedStyle(() => ({ opacity: reducedOpacity.value }));

  const compact = mode === "header" || mode === "loader";
  return (
    <Animated.View pointerEvents="none" accessibilityRole="image" accessibilityLabel="Trickee logo" style={[styles.root, { width: size }, rootStyle, exitStyle]}>
      <View style={{ width: size, height: size }}>
        <Animated.View style={[styles.grid, { width: size, height: size }, gridStyle]}>
          <Svg width={size} height={size} viewBox="0 0 500 500">
            {[0, 64, 128, 192, 256, 320, 384, 448, 500].map((coordinate) => (
              <React.Fragment key={coordinate}>
                <Line x1={coordinate} y1={0} x2={coordinate} y2={500} stroke={motionColors.cyan} strokeOpacity={0.13} strokeWidth={1} />
                <Line x1={0} y1={coordinate} x2={500} y2={coordinate} stroke={motionColors.cyan} strokeOpacity={0.13} strokeWidth={1} />
              </React.Fragment>
            ))}
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.halo, { width: size * 1.2, height: size * 1.2, borderRadius: size * 0.6, top: -size * 0.1, left: -size * 0.1 }, haloStyle]} />
        <Animated.View style={[styles.ripple, { width: size, height: size, borderRadius: size * 0.5 }, rippleOneStyle]} />
        <Animated.View style={[styles.ripple, styles.rippleCyan, { width: size, height: size, borderRadius: size * 0.5 }, rippleTwoStyle]} />
        <Animated.View style={[styles.orbit, { width: size * 0.95, height: size * 0.95, borderRadius: size * 0.475, top: size * 0.025, left: size * 0.025 }, orbitStyle]} />
        <Animated.View style={[styles.orbitInner, { width: size * 0.74, height: size * 0.74, borderRadius: size * 0.37, top: size * 0.13, left: size * 0.13 }, orbitStyle]} />
        <Animated.View style={[StyleSheet.absoluteFill, routeStyle]}>
          <Svg width={size} height={size} viewBox="0 0 500 500" fill="none">
            <AnimatedPath d={logoRoutePaths[0]} stroke={motionColors.yellow} strokeWidth={motionGeometry.logoStrokeWidth} strokeDasharray={`${logoRouteLengths[0]} ${logoRouteLengths[0]}`} animatedProps={routeProps1} />
            <AnimatedCircle cx={logoRouteCircle.cx} cy={logoRouteCircle.cy} r={logoRouteCircle.r} stroke={motionColors.yellow} strokeWidth={motionGeometry.logoStrokeWidth} strokeDasharray={`${logoRouteLengths[1]} ${logoRouteLengths[1]}`} animatedProps={routeProps2} />
            <AnimatedPath d={logoRoutePaths[1]} stroke={motionColors.yellow} strokeWidth={motionGeometry.logoStrokeWidth} strokeDasharray={`${logoRouteLengths[2]} ${logoRouteLengths[2]}`} animatedProps={routeProps3} />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.pulse, { top: size * 0.24, left: size * 0.49 }, pulseStyle]} />
        <Animated.Image source={brandArt} resizeMode="contain" style={[{ width: size, height: size }, artStyle]} />
      </View>
      {!compact && <Animated.View style={[styles.caption, captionStyle]}>
        <Text style={styles.captionText}>EVERY SIGNAL.</Text>
        <Text style={[styles.captionText, { color: motionColors.yellow }]}>A SMARTER JOURNEY.</Text>
      </Animated.View>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center" },
  grid: { position: "absolute", top: 0, left: 0 },
  halo: { position: "absolute", backgroundColor: "rgba(72,223,244,0.07)", shadowColor: motionColors.yellow, shadowOpacity: 0.25, shadowRadius: 34 },
  ripple: { position: "absolute", top: 0, left: 0, borderWidth: 1, borderColor: "rgba(255,230,147,0.38)" },
  rippleCyan: { borderColor: "rgba(72,223,244,0.28)" },
  orbit: { position: "absolute", borderWidth: 1, borderColor: "rgba(72,223,244,0.24)" },
  orbitInner: { position: "absolute", borderWidth: 1, borderColor: "rgba(255,224,0,0.28)" },
  pulse: { position: "absolute", zIndex: 3, width: 10, height: 10, borderRadius: 5, backgroundColor: "#FFF7B2", shadowColor: motionColors.yellow, shadowOpacity: 1, shadowRadius: 24, elevation: 8 },
  caption: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 14, marginTop: -10 },
  captionText: { color: "rgba(235,244,247,0.75)", fontFamily: fontFamily.technical, fontSize: 8, letterSpacing: 1.2, lineHeight: 15 },
});
