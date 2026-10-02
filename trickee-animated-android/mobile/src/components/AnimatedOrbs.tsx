import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Easing } from "react-native";

/**
 * AnimatedOrbs — Reusable drifting background orbs matching iOS OnboardingView/AuthView.
 *
 * iOS spec:
 *  - Yellow orb:  480×480, rgba(255,202,32,0.08), drift X ±180, Y ±120, 18s linear loop
 *  - Blue orb:    440×440, rgba(26,128,242,0.06),  drift X ±140, Y ±100, 22s linear loop
 *  - Purple orb:  400×400, rgba(179,102,242,0.05), drift X ±100, Y ±80,  15s linear loop
 *
 * All animation runs on the native driver so the JS thread stays free (avoids ANR).
 */
const AnimatedOrbs: React.FC = () => {
  const yellow = useRef(new Animated.Value(0)).current;
  const blue = useRef(new Animated.Value(0)).current;
  const purple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const drift = (value: Animated.Value, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );

    const animations = [
      drift(yellow, 18000),
      drift(blue, 22000),
      drift(purple, 15000),
    ];
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [yellow, blue, purple]);

  const range = (value: Animated.Value, x: number, y: number) => ({
    transform: [
      {
        translateX: value.interpolate({
          inputRange: [0, 1],
          outputRange: [-x, x],
        }),
      },
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [-y, y],
        }),
      },
    ],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      renderToHardwareTextureAndroid
    >
      <Animated.View
        style={[styles.orb, styles.yellowOrb, range(yellow, 180, 120)]}
      />
      <Animated.View
        style={[styles.orb, styles.blueOrb, range(blue, 140, 100)]}
      />
      <Animated.View
        style={[styles.orb, styles.purpleOrb, range(purple, 100, 80)]}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  orb: {
    position: "absolute",
    borderRadius: 250,
  },
  yellowOrb: {
    width: 480,
    height: 480,
    backgroundColor: "rgba(255, 202, 32, 0.08)",
    top: -100,
    left: -150,
  },
  blueOrb: {
    width: 440,
    height: 440,
    backgroundColor: "rgba(26, 128, 242, 0.06)",
    bottom: -50,
    right: -100,
  },
  purpleOrb: {
    width: 400,
    height: 400,
    backgroundColor: "rgba(179, 102, 242, 0.05)",
    top: "30%",
    right: -80,
  },
});

export default AnimatedOrbs;
