import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { DEMO_LOGINS, Features, SHOW_DEMO_LOGINS } from "../../config";
import { useAuth } from "../../context/AuthContext";
import { TrickeeLogoAnimated } from "../../components/logo/TrickeeLogoAnimated";
import { fontFamily } from "../../theme/typography";
import { motionColors } from "../../motion/tokens";

const LoginScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { login, googleLogin, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  const handleLogin = async () => {
    Keyboard.dismiss();
    try {
      await login(email.trim().toLowerCase(), password);
    } catch {}
  };

  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.ambientRing} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top + 20, 42), paddingBottom: insets.bottom + 28 },
        ]}
      >
        <View style={styles.masthead}>
          <Text style={styles.mastheadText}>TRICKEE / GPS DRIVER</Text>
          <View style={styles.mastheadLine} />
          <Text style={styles.mastheadText}>01 / ACCESS</Text>
        </View>

        <View style={[styles.hero, keyboardVisible && styles.heroCompact]}>
          {!keyboardVisible && <View style={styles.logoOrbit}>
            <View style={styles.logoOrbitInner} />
            <TrickeeLogoAnimated size={154} mode="header" />
          </View>}
          <Text style={styles.eyebrow}>INTELLIGENCE IN MOTION</Text>
          {!keyboardVisible && <>
            <Text style={styles.heroTitle}>Every signal.{"\n"}<Text style={styles.heroAccent}>A smarter journey.</Text></Text>
            <Text style={styles.heroCopy}>Your drive, energy, and route intelligence in one clear view.</Text>
          </>}
        </View>

        <View style={styles.accessPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelKicker}>SECURE ACCESS</Text>
              <Text style={styles.panelTitle}>Welcome back</Text>
            </View>
            <Icon name="shield-check-outline" size={24} color={motionColors.yellow} />
          </View>

          {Features.passwordLogin && (
            <View>
              <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="name@company.com"
                placeholderTextColor="#778A91"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                accessibilityLabel="Email address"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput
                ref={passwordRef}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor="#778A91"
                secureTextEntry
                autoComplete="current-password"
                accessibilityLabel="Password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.disabledButton]}
                onPress={handleLogin}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                {loading ? <ActivityIndicator color={motionColors.ink} /> : (
                  <>
                    <Text style={styles.primaryButtonText}>SIGN IN</Text>
                    <Icon name="arrow-top-right" size={20} color={motionColors.ink} />
                  </>
                )}
              </TouchableOpacity>
              {Features.googleLogin && <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
                <View style={styles.dividerLine} />
              </View>}
            </View>
          )}

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {Features.googleLogin && <TouchableOpacity
            style={styles.googleButton}
            onPress={() => googleLogin().catch(() => {})}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
          >
            <Text style={styles.googleButtonText}>Continue with Google</Text>
            <Icon name="arrow-right" size={18} color={motionColors.text} />
          </TouchableOpacity>}
        </View>

        {SHOW_DEMO_LOGINS && DEMO_LOGINS.length > 0 && (
          <View style={styles.demoSection}>
            <Text style={styles.demoLabel}>DEMO ACCESS</Text>
            <View style={styles.demoRow}>
              {DEMO_LOGINS.map((demo) => (
                <TouchableOpacity
                  key={demo.email}
                  style={styles.demoButton}
                  onPress={() => { setEmail(demo.email); setPassword(demo.password); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${demo.label} demo account`}
                >
                  <Text style={styles.demoText}>{demo.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {__DEV__ && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open Motion Gallery"
            style={styles.galleryButton}
            onPress={() => navigation.navigate("MotionGallery")}
          >
            <Text style={styles.galleryText}>EXPLORE MOTION GALLERY</Text>
            <Icon name="arrow-top-right" size={16} color={motionColors.cyan} />
          </TouchableOpacity>
        )}
        <View style={styles.footerRule} />
        <Text style={styles.footerText}>TRICKEE / ROUTE INTELLIGENCE</Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: motionColors.ink },
  ambientRing: { position: "absolute", top: 105, alignSelf: "center", width: 340, height: 340, borderRadius: 170, borderWidth: 1, borderColor: "rgba(72,223,244,0.07)", backgroundColor: "rgba(72,223,244,0.025)" },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  masthead: { flexDirection: "row", alignItems: "center", gap: 12 },
  mastheadText: { color: "#91A3A8", fontFamily: fontFamily.technical, fontSize: 7, letterSpacing: 1 },
  mastheadLine: { flex: 1, height: 1, backgroundColor: "rgba(72,223,244,0.28)" },
  hero: { alignItems: "center", marginTop: 22, marginBottom: 26 },
  heroCompact: { alignItems: "flex-start", marginTop: 18, marginBottom: 14 },
  logoOrbit: { width: 178, height: 178, alignItems: "center", justifyContent: "center", borderRadius: 89, borderWidth: 1, borderColor: "rgba(72,223,244,0.18)" },
  logoOrbitInner: { position: "absolute", width: 138, height: 138, borderRadius: 69, borderWidth: 1, borderColor: "rgba(255,224,0,0.12)" },
  eyebrow: { color: motionColors.yellow, fontFamily: fontFamily.technical, fontSize: 8, letterSpacing: 1.2, marginTop: 22 },
  heroTitle: { color: motionColors.text, fontFamily: fontFamily.headingBold, fontSize: 30, lineHeight: 34, letterSpacing: -1.2, textAlign: "center", marginTop: 10 },
  heroAccent: { color: motionColors.yellow },
  heroCopy: { maxWidth: 300, color: "#A7B7BB", fontFamily: fontFamily.body, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 10 },
  accessPanel: { backgroundColor: "#0C171C", borderWidth: 1, borderColor: "rgba(72,223,244,0.18)", borderRadius: 22, padding: 20 },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 19 },
  panelKicker: { color: motionColors.cyan, fontFamily: fontFamily.technical, fontSize: 7, letterSpacing: 1.2 },
  panelTitle: { color: motionColors.text, fontFamily: fontFamily.headingBold, fontSize: 22, letterSpacing: -0.6, marginTop: 4 },
  fieldLabel: { color: "#A4B4B8", fontFamily: fontFamily.technical, fontSize: 7, letterSpacing: 0.8, marginBottom: 8 },
  input: { minHeight: 50, paddingHorizontal: 14, marginBottom: 16, borderWidth: 1, borderColor: "rgba(168,208,214,0.18)", borderRadius: 10, backgroundColor: "#111F26", color: motionColors.text, fontFamily: fontFamily.bodyMedium, fontSize: 14 },
  primaryButton: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 10, backgroundColor: motionColors.yellow, marginTop: 2 },
  disabledButton: { opacity: 0.65 },
  primaryButtonText: { color: motionColors.ink, fontFamily: fontFamily.technical, fontSize: 10, letterSpacing: 1.3 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(168,208,214,0.16)" },
  dividerText: { color: "#809198", fontFamily: fontFamily.technical, fontSize: 6, letterSpacing: 0.6 },
  googleButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderWidth: 1, borderColor: "rgba(168,208,214,0.28)", borderRadius: 10 },
  googleButtonText: { color: motionColors.text, fontFamily: fontFamily.bodyBold, fontSize: 13 },
  error: { color: motionColors.coral, fontFamily: fontFamily.bodyMedium, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  demoSection: { marginTop: 24 },
  demoLabel: { color: "#8FA3A9", fontFamily: fontFamily.technical, fontSize: 7, letterSpacing: 1.2 },
  demoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  demoButton: { minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,224,0,0.2)", borderRadius: 8, backgroundColor: "rgba(255,224,0,0.06)" },
  demoText: { color: motionColors.yellow, fontFamily: fontFamily.bodySemibold, fontSize: 11 },
  galleryButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingHorizontal: 4 },
  galleryText: { color: motionColors.cyan, fontFamily: fontFamily.technical, fontSize: 8, letterSpacing: 1 },
  footerRule: { height: 1, backgroundColor: "rgba(72,223,244,0.2)", marginTop: 20 },
  footerText: { color: "#71858C", fontFamily: fontFamily.technical, fontSize: 7, letterSpacing: 1, marginTop: 12 },
});

export default LoginScreen;
