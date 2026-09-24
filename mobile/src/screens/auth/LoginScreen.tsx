/**
 * LoginScreen — same as existing app with demo login support.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Colors } from "../../constants/Colors";
import { useAuth } from "../../context/AuthContext";
import { DEMO_LOGINS, Features, SHOW_DEMO_LOGINS } from "../../config";
import { useNavigation } from "@react-navigation/native";
import { TrickeeLogoAnimated } from "../../components/logo/TrickeeLogoAnimated";
import { motionColors } from "../../motion/tokens";
import { fontFamily } from "../../theme/typography";

const LoginScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { login, googleLogin, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    try {
      await login(email.trim().toLowerCase(), password);
    } catch {}
  };

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.brand}><TrickeeLogoAnimated size={132} mode="header" /></View>
        <Text style={styles.subtitle}>GPS-First EV Intelligence</Text>

        {Features.passwordLogin && (
          <View>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={Colors.secondaryText}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={Colors.secondaryText}
              secureTextEntry
            />
            <TouchableOpacity
              style={styles.loginBtn}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={Colors.darkText} />
              ) : (
                <Text style={styles.loginText}>Sign In</Text>
              )}
            </TouchableOpacity>
            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.or}>or</Text>
              <View style={styles.line} />
            </View>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity
          style={styles.googleBtn}
          onPress={() => googleLogin().catch(() => {})}
          disabled={loading}
        >
          <Text style={styles.googleText}>Continue with Google</Text>
        </TouchableOpacity>

        {SHOW_DEMO_LOGINS && DEMO_LOGINS.length > 0 && (
          <View style={styles.demoSection}>
            <Text style={styles.demoLabel}>Demo Accounts</Text>
            {DEMO_LOGINS.map((d) => (
              <TouchableOpacity
                key={d.email}
                style={styles.demoBtn}
                onPress={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                }}
              >
                <Text style={styles.demoText}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {__DEV__ && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open Motion Gallery"
            style={styles.devGallery}
            onPress={() => navigation.navigate("MotionGallery")}
          >
            <Text style={styles.devGalleryText}>OPEN MOTION GALLERY</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: motionColors.ink,
    justifyContent: "center",
  },
  inner: { paddingHorizontal: 32 },
  brand: { alignItems: "center" },
  subtitle: {
    color: Colors.secondaryText,
    fontFamily: fontFamily.technical,
    fontSize: 9,
    letterSpacing: 1.2,
    textAlign: "center",
    marginBottom: 40,
  },
  input: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    color: Colors.primaryText,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  error: {
    color: Colors.red,
    fontSize: 12,
    textAlign: "center",
    marginBottom: 12,
  },
  loginBtn: {
    backgroundColor: Colors.trickeeYellow,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  loginText: { color: Colors.darkText, fontWeight: "800", fontSize: 16 },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 18 },
  line: { flex: 1, height: 1, backgroundColor: Colors.borderLight },
  or: { color: Colors.secondaryText, marginHorizontal: 12 },
  googleBtn: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  googleText: { color: Colors.primaryText, fontWeight: "700", fontSize: 15 },
  demoSection: { marginTop: 32, alignItems: "center" },
  demoLabel: {
    color: Colors.secondaryText,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  demoBtn: { paddingVertical: 8 },
  demoText: { color: Colors.trickeeYellow, fontSize: 13, fontWeight: "600" },
  devGallery: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 20 },
  devGalleryText: { color: Colors.trickeeYellow, fontSize: 10, letterSpacing: 1.2 },
});

export default LoginScreen;
