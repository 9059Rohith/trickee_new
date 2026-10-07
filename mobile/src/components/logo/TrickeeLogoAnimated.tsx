import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { logoRouteCircle, logoRoutePaths, logoTimeline } from '../../motion/logoTimeline';
import { motionColors } from '../../motion/tokens';
import type { IntroMode } from '../../services/introPresentation';

type Props = Readonly<{
  mode: Exclude<IntroMode, 'hidden'>;
  active: boolean;
  onComplete: () => void;
}>;

export default function TrickeeLogoAnimated({ mode, active, onComplete }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(mode === 'reduced' ? 0.98 : 0.88)).current;
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const duration = mode === 'reduced'
    ? logoTimeline.reducedDurationMs
    : logoTimeline.fullDurationMs;

  const animation = useMemo(() => Animated.parallel([
    Animated.timing(opacity, {
      toValue: 1,
      duration: mode === 'reduced' ? duration : 900,
      useNativeDriver: true,
    }),
    Animated.timing(scale, {
      toValue: 1,
      duration: mode === 'reduced' ? duration : 1350,
      useNativeDriver: true,
    }),
  ]), [duration, mode, opacity, scale]);

  useEffect(() => {
    if (!active) {
      animation.stop();
      return;
    }

    animation.start(({ finished }) => {
      if (finished && mode === 'reduced') {
        completeRef.current();
      }
    });

    const completion = mode === 'full'
      ? setTimeout(() => completeRef.current(), duration)
      : undefined;
    return () => {
      animation.stop();
      if (completion) clearTimeout(completion);
    };
  }, [active, animation, duration, mode]);

  return (
    <Animated.View
      testID="trickee-logo-animated"
      style={[styles.frame, { opacity, transform: [{ scale }] }]}
      accessible
      accessibilityLabel="Trickee route mark"
    >
      <View style={styles.halo} />
      <Svg width={216} height={216} viewBox="0 0 500 500">
        <Circle
          cx={logoRouteCircle.cx}
          cy={logoRouteCircle.cy}
          r={logoRouteCircle.r}
          stroke={motionColors.yellow}
          strokeWidth={8}
          fill="none"
        />
        {logoRoutePaths.map((path, index) => (
          <Path
            key={path}
            d={path}
            stroke={index === 0 ? motionColors.cyan : motionColors.yellow}
            strokeWidth={index === 0 ? 12 : 8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 236,
    height: 236,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 118,
    borderWidth: 1,
    borderColor: 'rgba(72, 223, 244, 0.32)',
    backgroundColor: 'rgba(72, 223, 244, 0.035)',
  },
});
