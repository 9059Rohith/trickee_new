import React, { useRef, useEffect, useCallback } from "react";
import {
  View,
  TouchableWithoutFeedback,
  Animated,
  StyleSheet,
  Platform,
} from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";

// Tab configuration
const TAB_CONFIG: Record<string, { icon: string; label: string }> = {
  Home: { icon: "home", label: "Home" },
  "Live Map": { icon: "map", label: "Live Map" },
  Monitoring: { icon: "gauge", label: "Monitoring" },
  More: { icon: "menu", label: "More" },
};

// ─────────────────────────────────────────
// SINGLE TAB BUTTON
// ─────────────────────────────────────────
interface LiquidGlassTabProps {
  routeName: string;
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const LiquidGlassTab: React.FC<LiquidGlassTabProps> = ({
  routeName,
  isFocused,
  onPress,
  onLongPress,
}) => {
  const config = TAB_CONFIG[routeName] || { icon: "circle", label: routeName };

  // ── Animation values ──
  const glassOpacity = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
  const glassScale = useRef(new Animated.Value(isFocused ? 1 : 0.92)).current;
  const containerTranslateY = useRef(
    new Animated.Value(isFocused ? -3 : 0)
  ).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  const labelOpacity = useRef(new Animated.Value(isFocused ? 1 : 0.38)).current;
  const shimmerOpacity = useRef(
    new Animated.Value(isFocused ? 0.65 : 0)
  ).current;
  const dotScale = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
  const dotOpacity = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
  const glowOpacity = useRef(new Animated.Value(0.5)).current;

  // Ripple
  const rippleScale = useRef(new Animated.Value(0)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  // Water Wave (Liquid effect) - disabled to fix ANR
  const waterAnim = useRef(new Animated.Value(0)).current;

  /*
  useEffect(() => {
    if (isFocused) {
      const water = Animated.loop(
        Animated.sequence([
          Animated.timing(waterAnim, {
            toValue: 1,
            duration: 2500,
            useNativeDriver: true,
          }),
          Animated.timing(waterAnim, {
            toValue: 0,
            duration: 2500,
            useNativeDriver: true,
          }),
        ]),
      );
      water.start();
      return () => water.stop();
    }
  }, [isFocused, waterAnim]);
  */

  const waterTranslateX = waterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-10, 10],
  });

  const waterTranslateY = waterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [4, -4],
  });

  const waterRotate = waterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["-5deg", "5deg"],
  });

  // ── Animation 5: Icon Glow Pulse (looping, active only) ──
  useEffect(() => {
    if (isFocused) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(glowOpacity, {
            toValue: 0.85,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0.5,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      glowOpacity.setValue(0);
    }
  }, [isFocused, glowOpacity]);

  // ── Animation 1 & 2 & 4: Tab Press / Activate ──
  useEffect(() => {
    const springConfig = {
      stiffness: 300,
      damping: 18,
      mass: 1,
      useNativeDriver: true,
    };

    if (isFocused) {
      // Glass slab: opacity 0→1, scale 0.92→1
      Animated.parallel([
        Animated.spring(glassOpacity, { ...springConfig, toValue: 1 }),
        Animated.spring(glassScale, { ...springConfig, toValue: 1 }),
        // Container lifts up
        Animated.spring(containerTranslateY, { ...springConfig, toValue: -3 }),
        // Label brightens
        Animated.timing(labelOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        // Active dot: scale 0→1.3→1
        Animated.sequence([
          Animated.spring(dotScale, { ...springConfig, toValue: 1.3 }),
          Animated.spring(dotScale, { ...springConfig, toValue: 1 }),
        ]),
        Animated.timing(dotOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        // Shimmer: 0 → 1 → 0.65
        Animated.sequence([
          Animated.timing(shimmerOpacity, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(shimmerOpacity, {
            toValue: 0.65,
            duration: 170,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Icon pop bounce: 1 → 1.18 → 1
      Animated.sequence([
        Animated.spring(iconScale, { ...springConfig, toValue: 1.18 }),
        Animated.spring(iconScale, { ...springConfig, toValue: 1 }),
      ]).start();
    } else {
      // Deactivate
      Animated.parallel([
        Animated.timing(glassOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(glassScale, {
          toValue: 0.92,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(containerTranslateY, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(labelOpacity, {
          toValue: 0.38,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotScale, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(iconScale, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [
    isFocused,
    glassOpacity,
    glassScale,
    containerTranslateY,
    labelOpacity,
    dotScale,
    dotOpacity,
    shimmerOpacity,
    iconScale,
  ]);

  // ── Animation 3: Ripple on Tap ──
  const triggerRipple = useCallback(() => {
    rippleScale.setValue(0);
    rippleOpacity.setValue(0.28);
    Animated.parallel([
      Animated.timing(rippleScale, {
        toValue: 3.5,
        duration: 480,
        useNativeDriver: true,
      }),
      Animated.timing(rippleOpacity, {
        toValue: 0,
        duration: 480,
        useNativeDriver: true,
      }),
    ]).start();
  }, [rippleScale, rippleOpacity]);

  const handlePress = useCallback(() => {
    triggerRipple();
    onPress();
  }, [triggerRipple, onPress]);

  const iconColor = isFocused ? Colors.trickeeYellow : "rgba(255,255,255,0.40)";

  return (
    <TouchableWithoutFeedback
      onPress={handlePress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={config.label}
      accessibilityState={isFocused ? { selected: true } : {}}
    >
      <Animated.View
        style={[
          tabStyles.tabButton,
          { transform: [{ translateY: containerTranslateY }] },
        ]}
      >
        {/* ── INNER GLASS SLAB ── */}
        <Animated.View
          style={[
            tabStyles.glassSlab,
            {
              opacity: glassOpacity,
              transform: [{ scale: glassScale }],
            },
          ]}
        >
          {/* ── Water Wave Animation ── */}
          <Animated.View
            style={[
              tabStyles.waterWave,
              {
                opacity: shimmerOpacity,
                transform: [
                  { translateX: waterTranslateX },
                  { translateY: waterTranslateY },
                  { rotate: waterRotate },
                ],
              },
            ]}
          />
          {/* Convex Top Highlight (::before) */}
          <Animated.View
            style={[tabStyles.convexHighlight, { opacity: shimmerOpacity }]}
          />
          {/* Bottom Rim Bounce (::after) */}
          <View style={tabStyles.rimBounce} />
          {/* Left Edge Catch Light */}
          <View style={tabStyles.edgeCatchLight} />
        </Animated.View>

        {/* ── RIPPLE ── */}
        <Animated.View
          style={[
            tabStyles.ripple,
            {
              opacity: rippleOpacity,
              transform: [{ scale: rippleScale }],
            },
          ]}
        />

        {/* ── ICON CONTAINER ── */}
        <Animated.View
          style={[tabStyles.iconWrap, { transform: [{ scale: iconScale }] }]}
        >
          {/* Glow behind icon (active only) */}
          {isFocused && (
            <Animated.View
              style={[tabStyles.iconGlow, { opacity: glowOpacity }]}
            />
          )}
          <Icon
            name={config.icon}
            size={24}
            color={iconColor}
            style={!isFocused ? tabStyles.inactiveIconShadow : undefined}
          />
        </Animated.View>

        {/* ── ACTIVE INDICATOR DOT ── */}
        <Animated.View
          style={[
            tabStyles.activeDot,
            {
              opacity: dotOpacity,
              transform: [{ scale: dotScale }],
            },
          ]}
        />

        {/* ── LABEL ── */}
        <Animated.Text
          style={[
            tabStyles.label,
            isFocused ? tabStyles.labelActive : tabStyles.labelInactive,
            { opacity: labelOpacity },
          ]}
          numberOfLines={1}
        >
          {config.label}
        </Animated.Text>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

// ─────────────────────────────────────────
// MAIN TAB BAR
// ─────────────────────────────────────────
const LiquidGlassTabBar: React.FC<BottomTabBarProps> = ({
  state,
  navigation,
}) => {
  // ── Animation 6: Nav Bar Entrance ──
  const entranceTranslateY = useRef(new Animated.Value(80)).current;
  const entranceOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(entranceTranslateY, {
          toValue: 0,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(entranceOpacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200); // 200ms delay

    return () => clearTimeout(timeout);
  }, [entranceTranslateY, entranceOpacity]);

  return (
    <Animated.View
      style={[
        barStyles.container,
        {
          opacity: entranceOpacity,
          transform: [{ translateY: entranceTranslateY }],
        },
      ]}
    >
      {/* Top highlight line — full-width gradient simulation */}
      <View style={barStyles.topHighlight}>
        <View style={barStyles.highlightLeft} />
        <View style={barStyles.highlightCenter} />
        <View style={barStyles.highlightRight} />
      </View>

      {/* Tab buttons */}
      <View style={barStyles.tabRow}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: "tabLongPress",
              target: route.key,
            });
          };

          return (
            <LiquidGlassTab
              key={route.key}
              routeName={route.name}
              isFocused={isFocused}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </Animated.View>
  );
};

// ─────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────

const barStyles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(4, 6, 10, 0.95)", // Darker to prevent merging with background
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.14)",
    paddingBottom: Platform.OS === "ios" ? 20 : 6,
    // Android shadow
    elevation: 24,
  },
  topHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  highlightLeft: {
    flex: 1,
    backgroundColor: "transparent",
  },
  highlightCenter: {
    flex: 2,
    backgroundColor: "rgba(255, 255, 255, 0.55)",
  },
  highlightRight: {
    flex: 1,
    backgroundColor: "transparent",
  },
  tabRow: {
    flexDirection: "row",
  },
});

const tabStyles = StyleSheet.create({
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 14,
    paddingBottom: 20,
    paddingHorizontal: 8,
    position: "relative",
    overflow: "hidden",
  },

  // ── Glass Slab ──
  glassSlab: {
    position: "absolute",
    top: 6,
    left: 4,
    right: 4,
    bottom: 6,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.11)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.24)",
    // Android box-shadow approximation
    elevation: 12,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    overflow: "hidden",
  },

  // ── Water Wave ──
  waterWave: {
    position: "absolute",
    bottom: -20,
    left: -20,
    right: -20,
    height: "70%",
    backgroundColor: "rgba(255, 202, 32, 0.12)",
    borderRadius: 30,
  },

  // ── Convex Top Highlight ──
  convexHighlight: {
    position: "absolute",
    top: 0,
    left: "8%",
    right: "8%",
    height: "45%",
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },

  // ── Bottom Rim Bounce ──
  rimBounce: {
    position: "absolute",
    bottom: 0,
    left: "10%",
    right: "10%",
    height: "28%",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },

  // ── Left Edge Catch Light ──
  edgeCatchLight: {
    position: "absolute",
    left: 0,
    top: 6,
    bottom: 6,
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.28)",
  },

  // ── Ripple ──
  ripple: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255, 255, 255, 0.28)",
    alignSelf: "center",
    top: "40%",
  },

  // ── Icon ──
  iconWrap: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    zIndex: 2,
  },
  iconGlow: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 202, 32, 0.45)",
    // Simulated blur glow with shadow
    ...Platform.select({
      ios: {
        shadowColor: Colors.trickeeYellow,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 10,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  inactiveIconShadow: {
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // ── Active Indicator Dot ──
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.trickeeYellow,
    marginTop: 4,
    zIndex: 2,
    // Glow
    ...Platform.select({
      ios: {
        shadowColor: Colors.trickeeYellow,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.55,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },

  // ── Label ──
  label: {
    fontSize: 11,
    letterSpacing: 0.3,
    marginTop: 2,
    zIndex: 2,
  },
  labelActive: {
    color: "#FFFFFF",
    fontWeight: "600",
    textShadowColor: "rgba(255,255,255,0.45)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  labelInactive: {
    color: "rgba(255,255,255,0.40)",
    fontWeight: "400",
  },
});

export default LiquidGlassTabBar;
