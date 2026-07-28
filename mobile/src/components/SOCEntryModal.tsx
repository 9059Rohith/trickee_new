/**
 * SOCEntryModal — manual SOC entry (§SOC boundary).
 *
 * Accessible from HomeScreen "Add SOC reading" action.
 * Sources: manual, dashboard_confirmed.
 * Calls api.recordSocReading().
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Colors } from "../constants/Colors";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

type Props = {
  visible: boolean;
  onClose: () => void;
  vehicleId: string;
  onRecorded?: () => void;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  onSubmit?: (soc: number) => Promise<void>;
};

const SOCEntryModal: React.FC<Props> = ({
  visible,
  onClose,
  vehicleId,
  onRecorded,
  title = "Add SOC Reading",
  subtitle = "Enter the current battery percentage from the vehicle dashboard.",
  submitLabel = "Save Reading",
  onSubmit,
}) => {
  const { token } = useAuth();
  const [socValue, setSocValue] = useState("");
  const [source, setSource] = useState<"manual" | "dashboard_confirmed">(
    "manual"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const val = parseFloat(socValue);
    if (isNaN(val) || val < 0 || val > 100) {
      setError("Enter a value between 0 and 100");
      return;
    }
    if (!token) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (onSubmit) {
        await onSubmit(val);
      } else {
        await api.recordSocReading(token, {
          vehicle_id: vehicleId,
          value: val,
          source,
        });
      }
      setSocValue("");
      onRecorded?.();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <TextInput
            style={styles.input}
            value={socValue}
            onChangeText={setSocValue}
            placeholder="e.g. 72"
            placeholderTextColor={Colors.secondaryText}
            keyboardType="numeric"
            maxLength={5}
            autoFocus
          />
          <Text style={styles.unit}>%</Text>

          <View style={styles.sourceRow}>
            <TouchableOpacity
              style={[
                styles.sourceBtn,
                source === "manual" && styles.sourceBtnActive,
              ]}
              onPress={() => setSource("manual")}
            >
              <Text
                style={[
                  styles.sourceText,
                  source === "manual" && styles.sourceTextActive,
                ]}
              >
                Manual Entry
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.sourceBtn,
                source === "dashboard_confirmed" && styles.sourceBtnActive,
              ]}
              onPress={() => setSource("dashboard_confirmed")}
            >
              <Text
                style={[
                  styles.sourceText,
                  source === "dashboard_confirmed" && styles.sourceTextActive,
                ]}
              >
                Dashboard Read
              </Text>
            </TouchableOpacity>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={Colors.darkText} size="small" />
              ) : (
                <Text style={styles.saveText}>{submitLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: Colors.cardBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    color: Colors.primaryText,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  subtitle: {
    color: Colors.secondaryText,
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 18,
  },
  input: {
    backgroundColor: Colors.appBackground,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    color: Colors.primaryText,
    fontSize: 32,
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: 16,
    marginBottom: 4,
  },
  unit: {
    color: Colors.secondaryText,
    textAlign: "center",
    fontSize: 14,
    marginBottom: 16,
  },
  sourceRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  sourceBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: "center",
  },
  sourceBtnActive: {
    borderColor: Colors.trickeeYellow,
    backgroundColor: Colors.estimatedBadgeBg,
  },
  sourceText: { color: Colors.secondaryText, fontSize: 12, fontWeight: "600" },
  sourceTextActive: { color: Colors.trickeeYellow },
  error: {
    color: Colors.red,
    fontSize: 12,
    textAlign: "center",
    marginBottom: 12,
  },
  actions: { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: "center",
  },
  cancelText: { color: Colors.secondaryText, fontWeight: "600" },
  saveBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.trickeeYellow,
    alignItems: "center",
  },
  saveText: { color: Colors.darkText, fontWeight: "700", fontSize: 15 },
});

export default SOCEntryModal;
