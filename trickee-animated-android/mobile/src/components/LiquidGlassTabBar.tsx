import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { motionColors } from "../motion/tokens";
import { fontFamily } from "../theme/typography";

const TAB_CONFIG: Record<string, { icon: string; label: string }> = {
  Home: { icon: "home-outline", label: "HOME" },
  "Live Map": { icon: "map-marker-path", label: "LIVE MAP" },
  Monitoring: { icon: "chart-timeline-variant", label: "MONITOR" },
  More: { icon: "view-grid-outline", label: "MORE" },
};

function TabButton({ routeName, isFocused, onPress, onLongPress, reducedMotion }: {
  routeName: string;
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  reducedMotion: boolean;
}) {
  const config = TAB_CONFIG[routeName] || { icon: "circle-outline", label: routeName.toUpperCase() };
  const active = useRef(new Animated.Value(isFocused ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      active.setValue(isFocused ? 1 : 0);
      return;
    }
    const animation = Animated.spring(active, {
      toValue: isFocused ? 1 : 0,
      stiffness: 260,
      damping: 25,
      mass: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, isFocused, reducedMotion]);

  const iconScale = active.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const iconLift = active.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  const indicatorScale = active.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  return (
    <Pressable
      style={styles.tab}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityLabel={config.label}
      accessibilityState={{ selected: isFocused }}
    >
      <Animated.View style={[styles.indicator, { opacity: active, transform: [{ scaleX: indicatorScale }] }]} />
      <Animated.View style={{ transform: [{ translateY: iconLift }, { scale: iconScale }] }}>
        <Icon name={config.icon} size={23} color={isFocused ? motionColors.yellow : "#8A9CA3"} />
      </Animated.View>
      <Text style={[styles.label, isFocused && styles.activeLabel]} numberOfLines={1}>{config.label}</Text>
    </Pressable>
  );
}

const LiquidGlassTabBar: React.FC<BottomTabBarProps> = ({ state, navigation }) => {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });
          return <TabButton key={route.key} routeName={route.name} isFocused={isFocused} onPress={onPress} onLongPress={onLongPress} reducedMotion={reducedMotion} />;
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { backgroundColor: "#071116", borderTopWidth: 1, borderTopColor: "rgba(72,223,244,0.18)" },
  row: { flexDirection: "row", paddingHorizontal: 10 },
  tab: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 5, paddingTop: 10 },
  indicator: { position: "absolute", top: 0, width: 38, height: 2, borderRadius: 1, backgroundColor: motionColors.yellow },
  label: { color: "#83959B", fontFamily: fontFamily.technical, fontSize: 8, letterSpacing: 0.35 },
  activeLabel: { color: motionColors.yellow },
});

export default LiquidGlassTabBar;
