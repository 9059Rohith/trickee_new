import React from "react";
import { View, Image, StyleSheet } from "react-native";
import { Colors } from "../constants/Colors";

/**
 * Faint, centered Trickee logo watermark used as a screen background. Sits
 * behind all content (zIndex 0, non-interactive) and lets the translucent
 * glass cards read as "glass" by giving them something to float over.
 */
interface BackgroundLogoProps {
  /** 0–1 logo opacity. Default tuned to be visible but subtle on near-black. */
  opacity?: number;
  /** Vertical bias: positive nudges the logo down, negative up. */
  offsetY?: number;
}

const BackgroundLogo: React.FC<BackgroundLogoProps> = ({
  opacity = 0.07,
  offsetY = -40,
}) => (
  <View style={styles.wrap} pointerEvents="none">
    {/* Soft brand glow behind the mark */}
    <View style={[styles.glow, { transform: [{ translateY: offsetY }] }]} />
    <Image
      source={require("../trickee_logo.png")}
      style={[styles.image, { opacity, transform: [{ translateY: offsetY }] }]}
      resizeMode="contain"
    />
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 0,
  },
  image: {
    width: "78%",
    height: "78%",
  },
  glow: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: Colors.trickeeYellow,
    opacity: 0.05,
  },
});

export default BackgroundLogo;
