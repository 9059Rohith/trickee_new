import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../constants/Colors';
import {
  AnimatedRouteName,
  routePresentationFor,
} from '../services/animatedRoutePresentation';
import { fontFamily } from '../theme/typography';

const RouteIdentityStrip: React.FC<{ route: AnimatedRouteName; compact?: boolean }> = ({
  route,
  compact = false,
}) => {
  const presentation = routePresentationFor(route);
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={presentation.accessibilityLabel}
      style={[styles.container, compact && styles.compact]}
    >
      <View style={styles.rule} />
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>{presentation.eyebrow}</Text>
        <Text style={[styles.title, compact && styles.compactTitle]}>{presentation.title}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 12,
  },
  compact: { marginTop: 10, marginBottom: 8 },
  rule: {
    width: 2,
    borderRadius: 2,
    backgroundColor: Colors.trickeeYellow,
    marginRight: 12,
  },
  copy: { flex: 1 },
  eyebrow: {
    color: Colors.trickeeYellow,
    fontFamily: fontFamily.technical,
    fontSize: 8,
    lineHeight: 14,
    letterSpacing: 1.25,
  },
  title: {
    color: Colors.primaryText,
    fontFamily: fontFamily.heading,
    fontSize: 24,
    lineHeight: 28,
    marginTop: 2,
  },
  compactTitle: { fontSize: 20, lineHeight: 24 },
});

export default RouteIdentityStrip;
