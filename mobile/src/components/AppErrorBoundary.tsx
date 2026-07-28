import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../constants/Colors";

type State = { failed: boolean };

class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("Trickee UI recovered from an error", error);
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <View style={styles.container}>
        <Icon
          name="shield-refresh-outline"
          size={58}
          color={Colors.trickeeYellow}
        />
        <Text style={styles.title}>Let&apos;s get you moving again</Text>
        <Text style={styles.message}>
          This screen hit an unexpected problem. Your trip data is still safe.
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.button}
          onPress={() => this.setState({ failed: false })}
        >
          <Text style={styles.buttonText}>Reload screen</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    backgroundColor: Colors.appBackground,
  },
  title: {
    color: Colors.white,
    fontSize: 22,
    fontWeight: "800",
    marginTop: 18,
  },
  message: {
    color: Colors.secondaryText,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  button: {
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 24,
    backgroundColor: Colors.trickeeYellow,
  },
  buttonText: { color: Colors.buttonText, fontSize: 14, fontWeight: "800" },
});

export default AppErrorBoundary;
