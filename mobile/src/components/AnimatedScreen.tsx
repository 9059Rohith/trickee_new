import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { motionState, type MotionMode } from '../motion/motionPolicy';
import { motionDuration } from '../motion/tokens';

type Props = Readonly<{
  children: React.ReactNode;
  focused: boolean;
  reducedMotion: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}>;

export default function AnimatedScreen({
  children,
  focused,
  reducedMotion,
  testID,
  style,
}: Props) {
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const mode: MotionMode = motionState({ reducedMotion, appActive, focused });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (mode !== 'full') {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    opacity.setValue(0);
    translateY.setValue(12);
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motionDuration.base,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: motionDuration.base,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [mode, opacity, translateY]);

  const motionStyle = useMemo(() => mode === 'full'
    ? { opacity, transform: [{ translateY }] }
    : { opacity: 1, transform: [{ translateY: 0 }] },
  [mode, opacity, translateY]);

  return (
    <Animated.View
      testID={testID}
      accessibilityValue={{ text: mode }}
      style={[styles.container, motionStyle, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
