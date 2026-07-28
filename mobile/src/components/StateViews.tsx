import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";

/** Full-area loading spinner with a caption. */
export const LoadingState: React.FC<{ label?: string }> = ({
  label = "Loading…",
}) => (
  <View style={styles.center}>
    <ActivityIndicator size="large" color={Colors.trickeeYellow} />
    <Text style={styles.caption}>{label}</Text>
  </View>
);

/** Error view with an optional retry action. */
export const ErrorState: React.FC<{
  message?: string;
  onRetry?: () => void;
}> = ({ message = "Something went wrong.", onRetry }) => (
  <View style={styles.center}>
    <Icon name="cloud-alert" size={40} color={Colors.redSoft} />
    <Text style={styles.title}>Connection problem</Text>
    <Text style={styles.caption}>{message}</Text>
    {onRetry && (
      <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
        <Icon name="refresh" size={16} color={Colors.buttonText} />
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    )}
  </View>
);

/** Neutral empty-state placeholder. */
export const EmptyState: React.FC<{
  icon?: string;
  title: string;
  subtitle?: string;
}> = ({ icon = "inbox", title, subtitle }) => (
  <View style={styles.centerCompact}>
    <Icon name={icon} size={30} color="rgba(255,255,255,0.35)" />
    <Text style={styles.emptyTitle}>{title}</Text>
    {subtitle ? <Text style={styles.caption}>{subtitle}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  centerCompact: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  title: { fontSize: 16, fontWeight: "700", color: Colors.white },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.7)",
  },
  caption: {
    fontSize: 13,
    color: Colors.secondaryText,
    textAlign: "center",
    lineHeight: 18,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 42,
    paddingHorizontal: 22,
    borderRadius: 21,
    backgroundColor: Colors.trickeeYellow,
    marginTop: 6,
  },
  retryText: { fontSize: 14, fontWeight: "700", color: Colors.buttonText },
});

export default { LoadingState, ErrorState, EmptyState };
