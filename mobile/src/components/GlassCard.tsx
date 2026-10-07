import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { Colors } from "../constants/Colors";

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  cornerRadius?: number;
  variant?: "premium" | "liquidGlass";
  highlightColor?: string;
}

const GlassCard: React.FC<GlassCardProps> = ({
  children,
  style,
  cornerRadius = 18,
  variant = "premium",
  highlightColor,
}) => {
  const isPremium = variant === "premium";

  return (
    <View
      style={[
        isPremium ? styles.premiumCard : styles.liquidGlassCard,
        { borderRadius: cornerRadius },
        style,
      ]}
    >
      {/* Inner border overlay */}
      <View
        pointerEvents="none"
        style={[
          isPremium ? styles.premiumInnerBorder : styles.liquidGlassInnerBorder,
          { borderRadius: cornerRadius },
        ]}
      />
      {/* Top-edge highlight bar (mimics iOS inner glow gradient) */}
      <View
        pointerEvents="none"
        style={[
          styles.topHighlight,
          {
            borderTopLeftRadius: cornerRadius,
            borderTopRightRadius: cornerRadius,
            backgroundColor: highlightColor
              ? highlightColor
              : isPremium
              ? Colors.premiumCardHighlight
              : Colors.liquidGlassHighlight,
          },
        ]}
      />
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  // Premium variant (matches iOS PremiumCardModifier)
  premiumCard: {
    backgroundColor: Colors.premiumCardBg,
    borderWidth: 1,
    borderColor: Colors.premiumCardBorder,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.34,
    shadowRadius: 14,
    elevation: 7,
    overflow: "hidden",
  },
  premiumInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: Colors.premiumCardInnerBorder,
  },

  // Liquid Glass variant (matches iOS LiquidGlassModifier)
  liquidGlassCard: {
    backgroundColor: Colors.liquidGlassBg,
    borderWidth: 1.5,
    borderColor: Colors.liquidGlassBorder,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    overflow: "hidden",
  },
  liquidGlassInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.04)",
  },

  // Shared top-edge highlight
  topHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    zIndex: 1,
  },
});

export default GlassCard;
