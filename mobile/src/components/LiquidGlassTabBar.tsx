import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Colors } from '../constants/Colors';
import { motionDuration } from '../motion/tokens';
import { runTabPress, tabPresentationFor } from '../services/navigationPresentation';
import { fontFamily } from '../theme/typography';

type TabProps = Readonly<{
  routeName: string;
  focused: boolean;
  reducedMotion: boolean;
  onPress: () => void;
  onLongPress: () => void;
}>;

function TabButton({
  routeName,
  focused,
  reducedMotion,
  onPress,
  onLongPress,
}: TabProps) {
  const presentation = tabPresentationFor(routeName);
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    const next = focused ? 1 : 0;
    if (reducedMotion) {
      progress.setValue(next);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: next,
      duration: motionDuration.fast,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [focused, progress, reducedMotion]);

  const lift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={presentation.label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.pressable}
    >
      <Animated.View style={[styles.tab, { transform: [{ translateY: lift }, { scale }] }]}>
        <Animated.View style={[styles.activeSurface, { opacity: progress }]} />
        <Icon
          name={presentation.icon}
          size={23}
          color={focused ? Colors.motionYellow : Colors.secondaryText}
        />
        <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
          {presentation.label}
        </Text>
        <Animated.View style={[styles.indicator, { opacity: progress }]} />
      </Animated.View>
    </Pressable>
  );
}

type Props = BottomTabBarProps & { onHeightChange?: (height: number) => void };

export default function LiquidGlassTabBar({ state, navigation, onHeightChange }: Props) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (mounted) setReducedMotion(value); })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const reportHeight = useCallback((event: LayoutChangeEvent) => {
    onHeightChange?.(event.nativeEvent.layout.height);
  }, [onHeightChange]);

  return (
    <View onLayout={reportHeight} style={styles.container} accessibilityRole="tablist">
      <View style={styles.topRule} />
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          return (
            <TabButton
              key={route.key}
              routeName={route.name}
              focused={focused}
              reducedMotion={reducedMotion}
              onPress={() => runTabPress(navigation, route, focused)}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 12,
    bottom: Platform.OS === 'ios' ? 14 : 8,
    left: 12,
    overflow: 'hidden',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(72, 223, 244, 0.2)',
    backgroundColor: 'rgba(3, 10, 14, 0.97)',
    elevation: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  topRule: {
    height: 1,
    marginHorizontal: 40,
    backgroundColor: 'rgba(72, 223, 244, 0.34)',
  },
  row: { flexDirection: 'row', paddingHorizontal: 5, paddingVertical: 6 },
  pressable: { flex: 1, minHeight: 62 },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
    borderRadius: 18,
  },
  activeSurface: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 224, 0, 0.18)',
    backgroundColor: 'rgba(255, 224, 0, 0.065)',
  },
  label: {
    color: Colors.secondaryText,
    fontFamily: fontFamily.bodyMedium,
    fontSize: 10,
  },
  labelActive: { color: Colors.primaryText, fontFamily: fontFamily.bodySemibold },
  indicator: {
    width: 16,
    height: 2,
    marginTop: 2,
    borderRadius: 1,
    backgroundColor: Colors.motionYellow,
  },
});
