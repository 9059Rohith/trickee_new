import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { motionColors } from '../../motion/tokens';
import type { IntroMode } from '../../services/introPresentation';
import { fontFamily } from '../../theme/typography';
import TrickeeLogoAnimated from './TrickeeLogoAnimated';

type Props = Readonly<{
  mode: Exclude<IntroMode, 'hidden'>;
  onComplete: () => void;
  fallbackMs?: number;
}>;

export default function LogoIntroOverlay({
  mode,
  onComplete,
  fallbackMs = 5750,
}: Props) {
  const completed = useRef(false);
  const [active, setActive] = useState(AppState.currentState === 'active');

  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    const fallback = setTimeout(finish, fallbackMs);
    const subscription = AppState.addEventListener('change', state => {
      setActive(state === 'active');
    });
    return () => {
      clearTimeout(fallback);
      subscription.remove();
    };
  }, [fallbackMs, finish]);

  return (
    <View
      testID="logo-intro-overlay"
      style={styles.overlay}
      accessibilityViewIsModal
    >
      <View style={styles.gridLineOne} />
      <View style={styles.gridLineTwo} />
      <TrickeeLogoAnimated mode={mode} active={active} onComplete={finish} />
      <Text style={styles.brand}>TRICKEE GPS DRIVER</Text>
      <Text style={styles.headline}>Route confidence for every journey.</Text>
      <View style={styles.copyRow}>
        <Text style={styles.copy}>Route clarity</Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.copy}>Live energy insight</Text>
        <Text style={styles.dot}>·</Text>
        <Text style={styles.copy}>Journey continuity</Text>
      </View>
      <Pressable
        testID="intro-skip"
        accessibilityRole="button"
        accessibilityLabel="Skip introduction"
        onPress={finish}
        style={styles.skip}
      >
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: motionColors.ink,
  },
  gridLineOne: {
    position: 'absolute',
    top: '28%',
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(72, 223, 244, 0.08)',
  },
  gridLineTwo: {
    position: 'absolute',
    bottom: '28%',
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255, 224, 0, 0.07)',
  },
  brand: {
    marginTop: 18,
    color: motionColors.cyan,
    fontFamily: fontFamily.technical,
    fontSize: 10,
    letterSpacing: 2.4,
  },
  headline: {
    maxWidth: 360,
    marginTop: 16,
    color: motionColors.text,
    fontFamily: fontFamily.headingBold,
    fontSize: 30,
    lineHeight: 34,
    textAlign: 'center',
  },
  copyRow: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  copy: {
    color: 'rgba(245, 248, 247, 0.72)',
    fontFamily: fontFamily.bodyMedium,
    fontSize: 12,
  },
  dot: {
    color: motionColors.yellow,
    fontSize: 14,
  },
  skip: {
    position: 'absolute',
    top: 52,
    right: 24,
    minWidth: 72,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(72, 223, 244, 0.38)',
    backgroundColor: 'rgba(7, 17, 24, 0.8)',
  },
  skipText: {
    color: motionColors.text,
    fontFamily: fontFamily.bodySemibold,
    fontSize: 14,
  },
});
