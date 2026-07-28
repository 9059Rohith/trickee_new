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

const CATEGORIES = ["2W_passenger", "2W_cargo", "3W_passenger", "3W_cargo"];

const VehicleOnboardingScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { token } = useAuth();
  const existingVehicle = route?.params?.vehicle;
  const isEdit = !!existingVehicle;

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
        style={styles.input}
        value={(form as any)[key]}
        onChangeText={(v) => set(key, v)}
        placeholder={placeholder}
        placeholderTextColor={Colors.secondaryText}
        keyboardType={numeric ? "numeric" : "default"}
      />
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>
        {isEdit ? "Update Vehicle Specs" : "Add New Vehicle"}
      </Text>
      <Text style={styles.subtitle}>
        Complete all required fields for GPS energy predictions.
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {renderInput("Vehicle Code *", "vehicle_code", "e.g. EV-X1")}
      {renderInput("Make *", "make", "e.g. Ather")}
      {renderInput("Model *", "model", "e.g. 450X")}
      {renderInput("Variant", "variant", "e.g. Gen 3")}

      {/* Category Picker */}
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

      {renderInput("Usable kWh", "usable_kwh", "e.g. 2.9", true)}
      {renderInput("Rated Ah", "rated_ah", "e.g. 56", true)}
      {renderInput("Battery Chemistry", "battery_chemistry", "LFP / NMC / NCA")}
      {renderInput("Nominal Voltage (V)", "nominal_voltage", "e.g. 51.8", true)}
      {renderInput("Motor Power (kW)", "motor_kw", "e.g. 6.0", true)}
      {renderInput("Kerb Weight (kg)", "kerb_weight", "e.g. 108", true)}
      {renderInput("GVW (kg)", "gvw", "e.g. 200", true)}
      {renderInput(
        "Payload Capacity (kg)",
        "payload_capacity",
        "e.g. 100",
        true
      )}
      {renderInput("Top Speed (km/h)", "top_speed", "e.g. 80", true)}
      {renderInput("Certified Range (km)", "certified_range", "e.g. 105", true)}

      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>Regen Available</Text>
        <Switch
          value={form.regen_available}
          onValueChange={(v) => set("regen_available", v)}
          trackColor={{ true: Colors.trickeeYellow, false: Colors.borderLight }}
          thumbColor={Colors.primaryText}
        />
      </View>

      <TouchableOpacity
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
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.appBackground },
  content: { padding: 16, paddingTop: 56, paddingBottom: 100 },
  title: {
    color: Colors.primaryText,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
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
