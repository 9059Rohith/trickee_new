/**
 * VehicleOnboardingScreen — add/edit vehicle with GPS-first spec fields (§7).
 *
 * Required fields: category, make, model, usable_kwh, battery_chemistry,
 * nominal_voltage, motor_kw, kerb_weight, top_speed.
 * Incomplete-spec vehicles show a warning that GPS predictions are unavailable.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Alert,
} from "react-native";
import { Colors } from "../constants/Colors";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import DetailHeader from "../components/DetailHeader";
import { canEditAdvancedVehicleSpecs } from "../services/navigationPolicy";

const CATEGORIES = ["2W_passenger", "2W_cargo", "3W_passenger", "3W_cargo"];

const VehicleOnboardingScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { token, user } = useAuth();
  const existingVehicle = route?.params?.vehicle;
  const isEdit = !!existingVehicle;
  const canEdit = canEditAdvancedVehicleSpecs(user?.role);

  const [form, setForm] = useState({
    vehicle_code: existingVehicle?.vehicle_code || "",
    make: existingVehicle?.make || "",
    model: existingVehicle?.model || "",
    category: existingVehicle?.category || "",
    variant: existingVehicle?.variant || "",
    usable_kwh: existingVehicle?.usable_kwh?.toString() || "",
    rated_ah: existingVehicle?.rated_ah?.toString() || "",
    battery_chemistry: existingVehicle?.battery_chemistry || "LFP",
    nominal_voltage: existingVehicle?.nominal_voltage?.toString() || "",
    motor_kw: existingVehicle?.motor_kw?.toString() || "",
    kerb_weight: existingVehicle?.kerb_weight?.toString() || "",
    gvw: existingVehicle?.gvw?.toString() || "",
    payload_capacity: existingVehicle?.payload_capacity?.toString() || "",
    top_speed: existingVehicle?.top_speed?.toString() || "",
    regen_available: existingVehicle?.regen_available ?? false,
    certified_range: existingVehicle?.certified_range?.toString() || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const set = (key: string, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!token) {
      return;
    }
    if (!form.vehicle_code.trim() || !form.make.trim() || !form.model.trim()) {
      setError("Vehicle code, make, and model are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data: any = {
        vehicle_code: form.vehicle_code.trim(),
        make: form.make.trim(),
        model: form.model.trim(),
        category: form.category || undefined,
        variant: form.variant || undefined,
        usable_kwh: form.usable_kwh ? parseFloat(form.usable_kwh) : undefined,
        rated_ah: form.rated_ah ? parseFloat(form.rated_ah) : undefined,
        battery_chemistry: form.battery_chemistry,
        nominal_voltage: form.nominal_voltage
          ? parseFloat(form.nominal_voltage)
          : undefined,
        motor_kw: form.motor_kw ? parseFloat(form.motor_kw) : undefined,
        kerb_weight: form.kerb_weight
          ? parseFloat(form.kerb_weight)
          : undefined,
        gvw: form.gvw ? parseFloat(form.gvw) : undefined,
        payload_capacity: form.payload_capacity
          ? parseFloat(form.payload_capacity)
          : undefined,
        top_speed: form.top_speed ? parseFloat(form.top_speed) : undefined,
        regen_available: form.regen_available,
        certified_range: form.certified_range
          ? parseFloat(form.certified_range)
          : undefined,
      };

      if (isEdit) {
        await api.updateVehicleSpecs(token, existingVehicle.id, data);
      } else {
        await api.createVehicle(token, data);
      }
      Alert.alert(
        "Success",
        isEdit ? "Vehicle specs updated" : "Vehicle created"
      );
      navigation.goBack();
    } catch (err: any) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const renderInput = (
    label: string,
    key: string,
    placeholder: string,
    numeric = false
  ) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={`vehicle-${key}`}
        accessibilityLabel={label}
        style={styles.input}
        value={(form as any)[key]}
        onChangeText={(v) => set(key, v)}
        placeholder={placeholder}
        placeholderTextColor={Colors.secondaryText}
        keyboardType={numeric ? "numeric" : "default"}
        editable={canEdit}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <DetailHeader
        title={isEdit ? "Vehicle details" : "Add vehicle"}
        subtitle={canEdit ? "Verified specifications" : "Fleet-managed specifications"}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.subtitle}>
        {canEdit
          ? "Review the vehicle identity first. Technical values are grouped under advanced specifications."
          : "These values are managed by your fleet administrator and are used by the GPS energy estimate."}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {renderInput("Vehicle Code *", "vehicle_code", "e.g. EV-X1")}
      {renderInput("Make *", "make", "e.g. Ather")}
      {renderInput("Model *", "model", "e.g. 450X")}
      {renderInput("Variant", "variant", "e.g. Gen 3")}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Category</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c}
              style={[
                styles.categoryBtn,
                form.category === c && styles.categoryBtnActive,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Vehicle category ${c.replace("_", " ")}`}
              accessibilityState={{ selected: form.category === c, disabled: !canEdit }}
              disabled={!canEdit}
              onPress={() => set("category", c)}
            >
              <Text
                style={[
                  styles.categoryText,
                  form.category === c && styles.categoryTextActive,
                ]}
              >
                {c.replace("_", " ")}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {canEdit ? (
        <TouchableOpacity
          testID="vehicle-advanced-toggle"
          accessibilityRole="button"
          accessibilityLabel={advancedOpen ? "Hide advanced vehicle specifications" : "Show advanced vehicle specifications"}
          accessibilityState={{ expanded: advancedOpen }}
          style={styles.advancedToggle}
          onPress={() => setAdvancedOpen(open => !open)}
        >
          <Text style={styles.advancedToggleText}>{advancedOpen ? "Hide advanced specifications" : "Edit advanced specifications"}</Text>
        </TouchableOpacity>
      ) : null}

      {canEdit && advancedOpen ? <View style={styles.advancedSection}>
        {renderInput("Usable battery (kWh)", "usable_kwh", "e.g. 2.9", true)}
        {renderInput("Rated capacity (Ah)", "rated_ah", "e.g. 56", true)}
        {renderInput("Battery chemistry", "battery_chemistry", "LFP / NMC / NCA")}
        {renderInput("Nominal voltage (V)", "nominal_voltage", "e.g. 51.8", true)}
        {renderInput("Motor power (kW)", "motor_kw", "e.g. 6.0", true)}
        {renderInput("Kerb weight (kg)", "kerb_weight", "e.g. 108", true)}
        {renderInput("Gross vehicle weight (kg)", "gvw", "e.g. 200", true)}
        {renderInput("Payload capacity (kg)", "payload_capacity", "e.g. 100", true)}
        {renderInput("Top speed (km/h)", "top_speed", "e.g. 80", true)}
        {renderInput("Certified range (km)", "certified_range", "e.g. 105", true)}

        <View style={styles.switchRow}>
          <Text style={styles.fieldLabel}>Regenerative braking available</Text>
          <Switch
            accessibilityLabel="Regenerative braking available"
            value={form.regen_available}
            onValueChange={(v) => set("regen_available", v)}
            trackColor={{ true: Colors.trickeeYellow, false: Colors.borderLight }}
            thumbColor={Colors.primaryText}
          />
        </View>
      </View> : null}

      {!canEdit ? <View style={styles.readOnlyNotice}><Text style={styles.readOnlyTitle}>Need a specification changed?</Text><Text style={styles.readOnlyText}>Ask your fleet administrator. Driver accounts cannot overwrite verified battery or vehicle values.</Text></View> : null}

      {canEdit ? <TouchableOpacity
        testID="vehicle-save"
        accessibilityRole="button"
        accessibilityLabel={isEdit ? "Save vehicle specifications" : "Add vehicle"}
        accessibilityState={{ disabled: saving }}
        style={styles.saveBtn}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color={Colors.darkText} />
        ) : (
          <Text style={styles.saveBtnText}>
            {isEdit ? "Update Specs" : "Add Vehicle"}
          </Text>
        )}
      </TouchableOpacity> : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, paddingBottom: 100 },
  subtitle: { color: Colors.secondaryText, fontSize: 13, marginBottom: 20 },
  error: {
    color: Colors.red,
    fontSize: 12,
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,68,68,0.08)",
  },
  field: { marginBottom: 14 },
  fieldLabel: {
    color: Colors.secondaryText,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 10,
    color: Colors.primaryText,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  categoryBtn: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  categoryBtnActive: {
    borderColor: Colors.trickeeYellow,
    backgroundColor: Colors.estimatedBadgeBg,
  },
  categoryText: {
    color: Colors.secondaryText,
    fontSize: 11,
    fontWeight: "600",
  },
  categoryTextActive: { color: Colors.trickeeYellow },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingVertical: 8,
  },
  advancedToggle: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: Colors.trickeeYellow, marginVertical: 10 },
  advancedToggleText: { color: Colors.trickeeYellow, fontSize: 14, fontWeight: "800" },
  advancedSection: { borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 16 },
  readOnlyNotice: { borderRadius: 12, borderWidth: 1, borderColor: Colors.borderLight, backgroundColor: Colors.cardBackground, padding: 14, marginTop: 10 },
  readOnlyTitle: { color: Colors.primaryText, fontSize: 15, fontWeight: "800", marginBottom: 5 },
  readOnlyText: { color: Colors.secondaryText, fontSize: 14, lineHeight: 20 },
  saveBtn: {
    backgroundColor: Colors.trickeeYellow,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnText: { color: Colors.darkText, fontWeight: "800", fontSize: 16 },
});

export default VehicleOnboardingScreen;
