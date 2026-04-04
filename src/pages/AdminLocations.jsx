import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { STENGESKJEMA_ID, defaultStengeskjema } from "../forms/defaultForms";
import { useAdminSession } from "../hooks/useAdminSession";
import "./Admin.css";

const DELIVERY_WEEKDAYS = [
  { value: "mon", label: "Man" },
  { value: "tue", label: "Tir" },
  { value: "wed", label: "Ons" },
  { value: "thu", label: "Tor" },
  { value: "fri", label: "Fre" },
  { value: "sat", label: "Lør" },
  { value: "sun", label: "Søn" },
];

const DELIVERY_MODE_OPTIONS = [
  { value: "", label: "Ingen valgt" },
  {
    value: "supplier_direct_to_location",
    label: "Leverandør leverer direkte til utsalgssted",
  },
  {
    value: "supplier_to_warehouse",
    label: "Leverandør leverer til lager",
  },
  {
    value: "crust_buy_and_deliver",
    label: "Crust kjøper inn og leverer",
  },
  {
    value: "crust_deliver_only",
    label: "Crust leverer",
  },
  {
    value: "employee_self_purchase",
    label: "Ansatte kjøper selv",
  },
];

function toSortOrder(item) {
  if (typeof item?.order === "number" && Number.isFinite(item.order)) {
    return item.order;
  }
  if (typeof item?.order === "string" && item.order.trim()) {
    const parsed = Number(item.order);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function parseQuestionOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions
      .map((option) => String(option || "").trim())
      .filter(Boolean);
  }

  if (typeof rawOptions === "string") {
    return rawOptions
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
  }

  return [];
}

function getAdminLocationsErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "permission-denied") {
    return "Ingen tilgang. Sjekk admin-innlogging og Firestore-regler.";
  }
  if (code === "unauthenticated") {
    return "Du må være logget inn som admin.";
  }
  return code ? `${fallbackMessage} (${code})` : fallbackMessage;
}

function normalizeDeliveryDays(value) {
  const values = Array.isArray(value) ? value : [];
  return DELIVERY_WEEKDAYS.map((day) => day.value).filter((day) =>
    values.includes(day),
  );
}

function formatDeliveryDayLabels(value) {
  const days = normalizeDeliveryDays(value);
  if (days.length === 0) {
    return "Ingen fast leveringstid";
  }

  return days
    .map(
      (dayValue) =>
        DELIVERY_WEEKDAYS.find((day) => day.value === dayValue)?.label || dayValue,
    )
    .join(", ");
}

function normalizeDeliveryMode(value) {
  const normalizedValue = String(value || "").trim();
  return DELIVERY_MODE_OPTIONS.some((option) => option.value === normalizedValue)
    ? normalizedValue
    : "";
}

function getDeliveryModeLabel(value) {
  return (
    DELIVERY_MODE_OPTIONS.find((option) => option.value === value)?.label ||
    "Ingen valgt"
  );
}

function inferLegacyDeliveryMode(savedSetting, hasSupplier) {
  if (savedSetting?.selfPurchase) {
    return "employee_self_purchase";
  }
  if (savedSetting?.crustDelivers && hasSupplier) {
    return "crust_deliver_only";
  }
  if (savedSetting?.crustDelivers) {
    return "crust_buy_and_deliver";
  }
  if (hasSupplier) {
    return "supplier_direct_to_location";
  }
  return "";
}

function showPopupMessage(message) {
  if (typeof window !== "undefined" && message) {
    window.alert(message);
  }
}

function getLocationCityLabel(location) {
  const normalizedCity = String(location?.city || location?.address || "").trim();
  return normalizedCity || "Ukjent by";
}

function getLocationProductSetting(location, questionId, suppliersById = {}) {
  const formSettings =
    location?.formSettings &&
    typeof location.formSettings === "object" &&
    location.formSettings[STENGESKJEMA_ID] &&
    typeof location.formSettings[STENGESKJEMA_ID] === "object"
      ? location.formSettings[STENGESKJEMA_ID]
      : {};
  const savedSetting =
    formSettings[questionId] && typeof formSettings[questionId] === "object"
      ? formSettings[questionId]
      : {};
  const selectedSupplierId =
    typeof savedSetting.supplierId === "string" ? savedSetting.supplierId.trim() : "";
  const selectedSupplier =
    selectedSupplierId && suppliersById[selectedSupplierId]
      ? suppliersById[selectedSupplierId]
      : null;
  const deliveryMode = normalizeDeliveryMode(savedSetting.deliveryMode)
    || inferLegacyDeliveryMode(savedSetting, Boolean(selectedSupplierId));

  return {
    deliveryMode,
    supplierId: selectedSupplierId,
    supplierName: selectedSupplier
      ? selectedSupplier.name
      : typeof savedSetting.supplierName === "string"
        ? savedSetting.supplierName.trim()
        : "",
    deliveryDays: selectedSupplier
      ? normalizeDeliveryDays(selectedSupplier.deliveryDays)
      : normalizeDeliveryDays(savedSetting.deliveryDays),
    crustDelivers:
      deliveryMode === "crust_buy_and_deliver" ||
      deliveryMode === "crust_deliver_only",
    selfPurchase: deliveryMode === "employee_self_purchase",
  };
}

function getCityProductSetting(cityGroup, questionId, suppliersById = {}) {
  const matchingLocation =
    (cityGroup?.locations || []).find((location) => {
      const value = getLocationProductSetting(location, questionId, suppliersById);
      return Boolean(
        value.deliveryMode ||
          value.supplierId ||
          value.deliveryDays.length > 0 ||
          value.crustDelivers ||
          value.selfPurchase,
      );
    }) ||
    cityGroup?.locations?.[0] ||
    null;

  return getLocationProductSetting(matchingLocation, questionId, suppliersById);
}

function areLocationProductSettingsEqual(previous, next) {
  if (previous.deliveryMode !== next.deliveryMode) {
    return false;
  }
  if (previous.supplierId !== next.supplierId) {
    return false;
  }
  if (previous.crustDelivers !== next.crustDelivers) {
    return false;
  }
  if (previous.selfPurchase !== next.selfPurchase) {
    return false;
  }
  if (previous.deliveryDays.length !== next.deliveryDays.length) {
    return false;
  }
  return previous.deliveryDays.every((day, index) => day === next.deliveryDays[index]);
}

function AdminLocations() {
  const { user, isAdmin, loading, error, signIn, signOutAdmin } = useAdminSession();
  const [locations, setLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [suppliersError, setSuppliersError] = useState("");
  const [supplierDrafts, setSupplierDrafts] = useState({});
  const [productQuestions, setProductQuestions] = useState([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [questionsError, setQuestionsError] = useState("");
  const [settingsDraft, setSettingsDraft] = useState({});
  const [saveState, setSaveState] = useState({ saving: false, error: "", message: "" });
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierDays, setNewSupplierDays] = useState([]);
  const [supplierCreateState, setSupplierCreateState] = useState({
    saving: false,
    error: "",
    message: "",
  });
  const [supplierPanelOpen, setSupplierPanelOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState("");
  const [supplierEditState, setSupplierEditState] = useState({
    savingId: "",
    error: "",
    message: "",
  });

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, "locations")),
      (snapshot) => {
        const nextLocations = snapshot.docs
          .map((locationDoc) => ({
            id: locationDoc.id,
            ...locationDoc.data(),
          }))
          .sort((a, b) => {
            const orderDiff = toSortOrder(a) - toSortOrder(b);
            if (orderDiff !== 0) {
              return orderDiff;
            }
            return String(a.name || "").localeCompare(String(b.name || ""), "nb");
          });

        setLocations(nextLocations);
        setLocationsError("");
        setLocationsLoading(false);
      },
      (nextError) => {
        setLocationsError(
          getAdminLocationsErrorMessage(
            nextError,
            "Kunne ikke hente lokasjoner akkurat nå.",
          ),
        );
        setLocationsLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, "suppliers")),
      (snapshot) => {
        const nextSuppliers = snapshot.docs
          .map((supplierDoc) => ({
            id: supplierDoc.id,
            ...supplierDoc.data(),
          }))
          .sort((a, b) =>
            String(a.name || "").localeCompare(String(b.name || ""), "nb"),
          );

        setSuppliers(nextSuppliers);
        setSuppliersError("");
        setSuppliersLoading(false);
      },
      (nextError) => {
        setSuppliersError(
          getAdminLocationsErrorMessage(
            nextError,
            "Kunne ikke hente leverandører akkurat nå.",
          ),
        );
        setSuppliersLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadQuestions() {
      setQuestionsLoading(true);
      setQuestionsError("");

      try {
        const snapshot = await getDocs(
          query(collection(db, "forms"), where("slug", "==", STENGESKJEMA_ID)),
        );
        const matching = snapshot.docs[0];
        const questions = matching
          ? matching.data()?.questions || []
          : defaultStengeskjema.questions || [];

        const nextQuestions = questions
          .filter(
            (question) =>
              question?.type === "select" && Boolean(question?.shouldRestock),
          )
          .map((question) => ({
            id: String(question.id || "").trim(),
            label: String(question.analysisLabel || question.label || "").trim(),
            options: parseQuestionOptions(question.options),
          }))
          .filter((question) => question.id && question.label);

        if (!cancelled) {
          setProductQuestions(nextQuestions);
        }
      } catch (nextError) {
        if (!cancelled) {
          setQuestionsError(
            getAdminLocationsErrorMessage(
              nextError,
              "Kunne ikke hente produkter fra stengeskjema.",
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setQuestionsLoading(false);
        }
      }
    }

    loadQuestions();

    return () => {
      cancelled = true;
    };
  }, []);

  const suppliersById = useMemo(
    () =>
      suppliers.reduce((accumulator, supplier) => {
        if (supplier?.id) {
          accumulator[supplier.id] = {
            ...supplier,
            name: String(supplier.name || "").trim(),
            deliveryDays: normalizeDeliveryDays(supplier.deliveryDays),
          };
        }
        return accumulator;
      }, {}),
    [suppliers],
  );

  const cityGroups = useMemo(
    () =>
      Object.values(
        locations.reduce((accumulator, location) => {
          const city = getLocationCityLabel(location);
          if (!accumulator[city]) {
            accumulator[city] = {
              id: city,
              city,
              locations: [],
            };
          }

          accumulator[city].locations.push(location);
          return accumulator;
        }, {}),
      ).sort((a, b) => a.city.localeCompare(b.city, "nb")),
    [locations],
  );

  const cityGroupsById = useMemo(
    () =>
      cityGroups.reduce((accumulator, cityGroup) => {
        accumulator[cityGroup.id] = cityGroup;
        return accumulator;
      }, {}),
    [cityGroups],
  );

  useEffect(() => {
    if (selectedCity && !cityGroupsById[selectedCity]) {
      setSelectedCity("");
    }
  }, [selectedCity, cityGroupsById]);

  useEffect(() => {
    if (suppliers.length === 0) {
      return;
    }

    setSupplierDrafts((previous) => {
      const next = {};
      let hasChange = false;

      suppliers.forEach((supplier) => {
        const previousDraft = previous?.[supplier.id];
        const fallbackDraft = {
          name: String(supplier.name || "").trim(),
          deliveryDays: normalizeDeliveryDays(supplier.deliveryDays),
        };
        const nextDraft = previousDraft
          ? {
              ...previousDraft,
              deliveryDays: normalizeDeliveryDays(previousDraft.deliveryDays),
            }
          : fallbackDraft;

        next[supplier.id] = nextDraft;

        if (
          !previousDraft ||
          previousDraft.name !== nextDraft.name ||
          previousDraft.deliveryDays.length !== nextDraft.deliveryDays.length ||
          previousDraft.deliveryDays.some(
            (day, index) => day !== nextDraft.deliveryDays[index],
          )
        ) {
          hasChange = true;
        }
      });

      if (
        Object.keys(previous).length !== Object.keys(next).length ||
        hasChange
      ) {
        return next;
      }

      return previous;
    });
  }, [suppliers]);

  useEffect(() => {
    if (cityGroups.length === 0 || productQuestions.length === 0) {
      return;
    }

    setSettingsDraft((previous) => {
      const next = {};
      let hasChange = false;

      cityGroups.forEach((cityGroup) => {
        next[cityGroup.id] = {};

        productQuestions.forEach((question) => {
          const existing = previous?.[cityGroup.id]?.[question.id];
          const fallback = getCityProductSetting(
            cityGroup,
            question.id,
            suppliersById,
          );
          const normalized = existing
            ? {
                ...existing,
                supplierName: fallback.supplierName,
                deliveryDays: existing.supplierId
                  ? normalizeDeliveryDays(fallback.deliveryDays)
                  : normalizeDeliveryDays(existing.deliveryDays),
              }
            : fallback;

          next[cityGroup.id][question.id] = {
            deliveryMode: normalizeDeliveryMode(normalized.deliveryMode),
            supplierId: String(normalized.supplierId || "").trim(),
            supplierName: String(normalized.supplierName || "").trim(),
            deliveryDays: normalizeDeliveryDays(normalized.deliveryDays),
            crustDelivers: Boolean(normalized.crustDelivers),
            selfPurchase: Boolean(normalized.selfPurchase),
          };

          if (
            !existing ||
            !areLocationProductSettingsEqual(existing, next[cityGroup.id][question.id])
          ) {
            hasChange = true;
          }
        });
      });

      if (!hasChange && Object.keys(previous).length === Object.keys(next).length) {
        return previous;
      }

      return next;
    });
  }, [cityGroups, productQuestions, suppliersById]);

  const hasLocations = locations.length > 0;
  const hasCities = cityGroups.length > 0;
  const hasProducts = productQuestions.length > 0;
  const canSave =
    isAdmin &&
    hasCities &&
    hasProducts &&
    !locationsLoading &&
    !questionsLoading &&
    !suppliersLoading;

  const cityCards = useMemo(
    () =>
      (selectedCity
        ? cityGroups.filter((cityGroup) => cityGroup.id === selectedCity)
        : cityGroups
      ).map((cityGroup) => ({
        ...cityGroup,
        productSettings: productQuestions.map((question) => ({
          question,
          value: (() => {
            const draftValue = settingsDraft?.[cityGroup.id]?.[question.id];
            if (!draftValue) {
              return getCityProductSetting(cityGroup, question.id, suppliersById);
            }

            if (!draftValue.supplierId) {
              return draftValue;
            }

            const supplierValue = getLocationProductSetting(
              {
                formSettings: {
                  [STENGESKJEMA_ID]: {
                    [question.id]: draftValue,
                  },
                },
              },
              question.id,
              suppliersById,
            );

            return {
              ...draftValue,
              supplierName: supplierValue.supplierName,
              deliveryDays: supplierValue.deliveryDays,
            };
          })(),
        })),
      })),
    [cityGroups, productQuestions, selectedCity, settingsDraft, suppliersById],
  );

  function onToggleDeliveryDay(locationId, questionId, dayValue) {
    setSettingsDraft((previous) => {
      const current = previous?.[locationId]?.[questionId] || {
        deliveryMode: "",
        deliveryDays: [],
        crustDelivers: false,
        selfPurchase: false,
      };
      const hasDay = current.deliveryDays.includes(dayValue);
      const nextDays = hasDay
        ? current.deliveryDays.filter((value) => value !== dayValue)
        : [...current.deliveryDays, dayValue];

      return {
        ...previous,
        [locationId]: {
          ...(previous[locationId] || {}),
          [questionId]: {
            ...current,
            deliveryDays: normalizeDeliveryDays(nextDays),
          },
        },
      };
    });
  }

  function onToggleSelfPurchase(locationId, questionId, checked) {
    setSettingsDraft((previous) => {
      const current = previous?.[locationId]?.[questionId] || {
        deliveryMode: "",
        deliveryDays: [],
        crustDelivers: false,
        selfPurchase: false,
      };

      return {
        ...previous,
        [locationId]: {
          ...(previous[locationId] || {}),
          [questionId]: {
            ...current,
            selfPurchase: checked,
          },
        },
      };
    });
  }

  function onToggleCrustDelivers(locationId, questionId, checked) {
    setSettingsDraft((previous) => {
      const current = previous?.[locationId]?.[questionId] || {
        deliveryMode: "",
        deliveryDays: [],
        crustDelivers: false,
        selfPurchase: false,
      };

      return {
        ...previous,
        [locationId]: {
          ...(previous[locationId] || {}),
          [questionId]: {
            ...current,
            crustDelivers: checked,
          },
        },
      };
    });
  }

  function onToggleNewSupplierDay(dayValue) {
    setNewSupplierDays((previous) => {
      const hasDay = previous.includes(dayValue);
      const nextDays = hasDay
        ? previous.filter((value) => value !== dayValue)
        : [...previous, dayValue];
      return normalizeDeliveryDays(nextDays);
    });
  }

  function onChangeSupplierDraftName(supplierId, value) {
    setSupplierDrafts((previous) => ({
      ...previous,
      [supplierId]: {
        ...(previous[supplierId] || { name: "", deliveryDays: [] }),
        name: String(value || ""),
      },
    }));
  }

  function onToggleSupplierDraftDay(supplierId, dayValue) {
    setSupplierDrafts((previous) => {
      const current = previous?.[supplierId] || { name: "", deliveryDays: [] };
      const hasDay = current.deliveryDays.includes(dayValue);
      const nextDays = hasDay
        ? current.deliveryDays.filter((value) => value !== dayValue)
        : [...current.deliveryDays, dayValue];

      return {
        ...previous,
        [supplierId]: {
          ...current,
          deliveryDays: normalizeDeliveryDays(nextDays),
        },
      };
    });
  }

  async function onSaveSupplier(supplierId) {
    const draft = supplierDrafts?.[supplierId] || { name: "", deliveryDays: [] };
    const normalizedName = String(draft.name || "").trim();
    const normalizedDays = normalizeDeliveryDays(draft.deliveryDays);

    if (!normalizedName) {
      showPopupMessage("Skriv inn navn på leverandør.");
      return;
    }

    setSupplierEditState({ savingId: supplierId, error: "", message: "" });

    try {
      await updateDoc(doc(db, "suppliers", supplierId), {
        name: normalizedName,
        deliveryDays: normalizedDays,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });

      setSupplierEditState({
        savingId: "",
        error: "",
        message: "Leverandør oppdatert.",
      });
    } catch (nextError) {
      const message = getAdminLocationsErrorMessage(
        nextError,
        "Kunne ikke oppdatere leverandør.",
      );
      setSupplierEditState({
        savingId: "",
        error: "",
        message: "",
      });
      showPopupMessage(message);
    }
  }

  function onSelectSupplier(locationId, questionId, supplierId) {
    const normalizedSupplierId = String(supplierId || "").trim();
    const selectedSupplier =
      normalizedSupplierId && suppliersById[normalizedSupplierId]
        ? suppliersById[normalizedSupplierId]
        : null;

    setSettingsDraft((previous) => {
      const current = previous?.[locationId]?.[questionId] || {
        deliveryMode: "",
        supplierId: "",
        supplierName: "",
        deliveryDays: [],
        crustDelivers: false,
        selfPurchase: false,
      };

      return {
        ...previous,
        [locationId]: {
          ...(previous[locationId] || {}),
          [questionId]: {
            ...current,
            supplierId: normalizedSupplierId,
            supplierName: selectedSupplier ? selectedSupplier.name : "",
            deliveryDays: selectedSupplier
              ? normalizeDeliveryDays(selectedSupplier.deliveryDays)
              : current.deliveryDays,
          },
        },
      };
    });
  }

  function onChangeDeliveryMode(locationId, questionId, nextDeliveryMode) {
    const normalizedDeliveryMode = normalizeDeliveryMode(nextDeliveryMode);

    setSettingsDraft((previous) => {
      const current = previous?.[locationId]?.[questionId] || {
        deliveryMode: "",
        supplierId: "",
        supplierName: "",
        deliveryDays: [],
        crustDelivers: false,
        selfPurchase: false,
      };

      return {
        ...previous,
        [locationId]: {
          ...(previous[locationId] || {}),
          [questionId]: {
            ...current,
            deliveryMode: normalizedDeliveryMode,
            crustDelivers:
              normalizedDeliveryMode === "crust_buy_and_deliver" ||
              normalizedDeliveryMode === "crust_deliver_only",
            selfPurchase: normalizedDeliveryMode === "employee_self_purchase",
          },
        },
      };
    });
  }

  async function onCreateSupplier() {
    const normalizedName = String(newSupplierName || "").trim();
    const normalizedDays = normalizeDeliveryDays(newSupplierDays);
    if (!normalizedName) {
      const message = "Skriv inn navn på leverandør.";
      setSupplierCreateState({
        saving: false,
        error: "",
        message: "",
      });
      showPopupMessage(message);
      return;
    }

    setSupplierCreateState({ saving: true, error: "", message: "" });

    try {
      await addDoc(collection(db, "suppliers"), {
        name: normalizedName,
        deliveryDays: normalizedDays,
        createdAt: serverTimestamp(),
        createdBy: user?.email || "admin",
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });

      setNewSupplierName("");
      setNewSupplierDays([]);
      setSupplierCreateState({
        saving: false,
        error: "",
        message: "Leverandør lagret.",
      });
    } catch (nextError) {
      const message = getAdminLocationsErrorMessage(
        nextError,
        "Kunne ikke lagre leverandør.",
      );
      setSupplierCreateState({
        saving: false,
        error: "",
        message: "",
      });
      showPopupMessage(message);
    }
  }

  async function onSaveSettings() {
    if (!canSave) {
      return;
    }

    setSaveState({ saving: true, error: "", message: "" });

    try {
      await Promise.all(
        locations.map(async (location) => {
          const cityKey = getLocationCityLabel(location);
          const cityGroup = cityGroupsById[cityKey];
          const existingFormSettings =
            location.formSettings && typeof location.formSettings === "object"
              ? location.formSettings
              : {};
          const existingStengeskjemaSettings =
            existingFormSettings[STENGESKJEMA_ID] &&
            typeof existingFormSettings[STENGESKJEMA_ID] === "object"
              ? existingFormSettings[STENGESKJEMA_ID]
              : {};

          const nextStengeskjemaSettings = productQuestions.reduce((accumulator, question) => {
            const draftValue =
              settingsDraft?.[cityKey]?.[question.id] ||
              getCityProductSetting(cityGroup, question.id, suppliersById);
            const normalizedDraftValue =
              draftValue.supplierId && suppliersById[draftValue.supplierId]
                ? {
                    ...draftValue,
                    supplierName: suppliersById[draftValue.supplierId].name,
                    deliveryDays: normalizeDeliveryDays(
                      suppliersById[draftValue.supplierId].deliveryDays,
                    ),
                  }
                : draftValue;
            const existingQuestionSettings =
              existingStengeskjemaSettings[question.id] &&
              typeof existingStengeskjemaSettings[question.id] === "object"
                ? existingStengeskjemaSettings[question.id]
                : {};

            accumulator[question.id] = {
              ...existingQuestionSettings,
              deliveryMode: normalizeDeliveryMode(normalizedDraftValue.deliveryMode),
              supplierId: String(normalizedDraftValue.supplierId || "").trim(),
              supplierName: String(normalizedDraftValue.supplierName || "").trim(),
              deliveryDays: normalizeDeliveryDays(normalizedDraftValue.deliveryDays),
              crustDelivers: Boolean(normalizedDraftValue.crustDelivers),
              selfPurchase: Boolean(normalizedDraftValue.selfPurchase),
            };
            return accumulator;
          }, {});

          await updateDoc(doc(db, "locations", location.id), {
            formSettings: {
              ...existingFormSettings,
              [STENGESKJEMA_ID]: nextStengeskjemaSettings,
            },
            updatedAt: serverTimestamp(),
            updatedBy: user?.email || "admin",
          });
        }),
      );

      setSaveState({
        saving: false,
        error: "",
        message: "Byoppsett for levering er lagret.",
      });
    } catch (nextError) {
      setSaveState({
        saving: false,
        error: getAdminLocationsErrorMessage(
          nextError,
          "Kunne ikke lagre leveringsoppsett.",
        ),
        message: "",
      });
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-hero">
        <p className="eyebrow">Admin</p>
        <h1>Leverandører og levering</h1>
        <p>
          Sett leveringsmåte per produkt og by. Alle lokasjoner i samme by deler
          samme leveringsoppsett, leverandør og leveringstid.
        </p>
      </header>

      {!loading && !isAdmin ? (
        <button type="button" className="admin-login-link" onClick={signIn}>
          Admin login
        </button>
      ) : null}
      {!loading && !isAdmin && error ? (
        <p className="forms-error">{error}</p>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <p>Innlogget som {user?.email}</p>
          <div className="admin-actions">
            <Link className="admin-button admin-button-secondary" to="/admin">
              Tilbake til /admin
            </Link>
            <Link className="admin-button admin-button-secondary" to="/plasseringer">
              Se /plasseringer
            </Link>
            <Link className="admin-button admin-button-secondary" to={`/skjema/${STENGESKJEMA_ID}/edit`}>
              Rediger stengeskjema
            </Link>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={signOutAdmin}
            >
              Logg ut
            </button>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <div className="admin-supplier-panel-header">
            <h2>Leverandører</h2>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={() => setSupplierPanelOpen((previous) => !previous)}
            >
              {supplierPanelOpen ? "Lukk" : "Åpne"}
            </button>
          </div>
          {supplierPanelOpen ? (
            <>
              <div className="admin-supplier-create-row">
                <label className="field-block admin-supplier-name-field">
                  <span>Ny leverandør</span>
                  <input
                    type="text"
                    value={newSupplierName}
                    onChange={(event) => setNewSupplierName(event.target.value)}
                    placeholder="f.eks. Asko"
                  />
                </label>
                <div className="admin-supplier-days-block">
                  <span>Leveringsdager</span>
                  <div className="admin-weekday-list">
                    {DELIVERY_WEEKDAYS.map((day) => (
                      <label key={`new-supplier-${day.value}`} className="admin-weekday-chip">
                        <input
                          type="checkbox"
                          checked={newSupplierDays.includes(day.value)}
                          onChange={() => onToggleNewSupplierDay(day.value)}
                        />
                        <span>{day.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="admin-inline-actions">
                  <button
                    type="button"
                    className="admin-button"
                    onClick={onCreateSupplier}
                    disabled={supplierCreateState.saving}
                  >
                    {supplierCreateState.saving ? "Lagrer..." : "Opprett leverandør"}
                  </button>
                </div>
              </div>
              {suppliersError ? <p className="forms-error">{suppliersError}</p> : null}
              {supplierCreateState.message ? (
                <p className="forms-success">{supplierCreateState.message}</p>
              ) : null}
              {supplierEditState.message ? (
                <p className="forms-success">{supplierEditState.message}</p>
              ) : null}
              {suppliersLoading ? <p>Laster leverandører...</p> : null}
              {!suppliersLoading && suppliers.length === 0 ? (
                <p>Ingen leverandører opprettet ennå.</p>
              ) : null}
              {!suppliersLoading && suppliers.length > 0 ? (
                <div className="admin-supplier-list">
                  {suppliers.map((supplier) => (
                    <div key={supplier.id} className="admin-supplier-card">
                      <div className="admin-supplier-card-header">
                        <strong>{supplier.name || "Uten navn"}</strong>
                        <button
                          type="button"
                          className="admin-button admin-button-secondary"
                          onClick={() =>
                            setEditingSupplierId((previous) =>
                              previous === supplier.id ? "" : supplier.id,
                            )
                          }
                        >
                          {editingSupplierId === supplier.id ? "Lukk" : "Rediger"}
                        </button>
                      </div>
                      {editingSupplierId === supplier.id ? (
                        <>
                          <label className="field-block admin-supplier-name-field">
                            <span>Navn</span>
                            <input
                              type="text"
                              value={supplierDrafts?.[supplier.id]?.name || ""}
                              onChange={(event) =>
                                onChangeSupplierDraftName(supplier.id, event.target.value)
                              }
                            />
                          </label>
                          <div className="admin-supplier-days-block">
                            <span>Leveringsdager</span>
                            <div className="admin-weekday-list">
                              {DELIVERY_WEEKDAYS.map((day) => (
                                <label
                                  key={`${supplier.id}-${day.value}`}
                                  className="admin-weekday-chip"
                                >
                                  <input
                                    type="checkbox"
                                    checked={Boolean(
                                      supplierDrafts?.[supplier.id]?.deliveryDays?.includes(day.value),
                                    )}
                                    onChange={() =>
                                      onToggleSupplierDraftDay(supplier.id, day.value)
                                    }
                                  />
                                  <span>{day.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <p className="admin-muted">
                            {formatDeliveryDayLabels(
                              supplierDrafts?.[supplier.id]?.deliveryDays || [],
                            )}
                          </p>
                          <div className="admin-supplier-card-actions">
                            <button
                              type="button"
                              className="admin-button admin-button-secondary"
                              onClick={() => onSaveSupplier(supplier.id)}
                              disabled={supplierEditState.savingId === supplier.id}
                            >
                              {supplierEditState.savingId === supplier.id
                                ? "Lagrer..."
                                : "Lagre leverandør"}
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <div className="admin-inline-actions">
            {hasCities ? (
              <label className="field-block admin-supplier-select-field">
                <span>Byfilter</span>
                <select
                  value={selectedCity}
                  onChange={(event) => setSelectedCity(event.target.value)}
                >
                  <option value="">Alle byer</option>
                  {cityGroups.map((cityGroup) => (
                    <option key={cityGroup.id} value={cityGroup.id}>
                      {cityGroup.city}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              className="admin-button"
              onClick={onSaveSettings}
              disabled={!canSave || saveState.saving}
            >
              {saveState.saving ? "Lagrer..." : "Lagre leveringsoppsett"}
            </button>
          </div>
          {locationsError ? <p className="forms-error">{locationsError}</p> : null}
          {questionsError ? <p className="forms-error">{questionsError}</p> : null}
          {saveState.error ? <p className="forms-error">{saveState.error}</p> : null}
          {saveState.message ? <p className="forms-success">{saveState.message}</p> : null}
          {locationsLoading ? <p>Laster lokasjoner...</p> : null}
          {suppliersLoading ? <p>Laster leverandører...</p> : null}
          {questionsLoading ? <p>Laster produkter fra stengeskjema...</p> : null}
          {!locationsLoading && !hasLocations ? (
            <p>Ingen lokasjoner funnet ennå. Sjekk /plasseringer.</p>
          ) : null}
          {!questionsLoading && !hasProducts ? (
            <p>Ingen relevante produktspørsmål funnet i stengeskjema.</p>
          ) : null}
        </section>
      ) : null}

      {isAdmin && hasCities && hasProducts ? (
        <section className="admin-panel">
          <div className="admin-location-settings-list">
            {cityCards.map((cityGroup) => (
              <article key={cityGroup.id} className="admin-location-settings-card">
                <div className="admin-location-settings-header">
                  <div>
                    <h2>{cityGroup.city}</h2>
                    <p className="admin-muted">
                      {cityGroup.locations.length}{" "}
                      {cityGroup.locations.length === 1 ? "lokasjon" : "lokasjoner"}
                    </p>
                  </div>
                </div>

                <div className="admin-location-product-list">
                  {cityGroup.productSettings.map(({ question, value }) => (
                    <div
                      key={`${cityGroup.id}-${question.id}`}
                      className="admin-location-product-row"
                    >
                      {(() => {
                        const selectedSupplier =
                          value.supplierId && suppliersById[value.supplierId]
                            ? suppliersById[value.supplierId]
                            : null;
                        const supplierHasDefinedDeliveryDays = Boolean(
                          selectedSupplier &&
                            normalizeDeliveryDays(selectedSupplier.deliveryDays).length > 0,
                        );

                        return (
                          <>
                      <div className="admin-location-product-copy">
                        <strong>{question.label}</strong>
                      </div>

                      <div className="admin-location-product-controls">
                        <label className="field-block admin-supplier-select-field">
                          <span>Leveringsmåte</span>
                          <select
                            value={value.deliveryMode || ""}
                            onChange={(event) =>
                              onChangeDeliveryMode(
                                cityGroup.id,
                                question.id,
                                event.target.value,
                              )
                            }
                          >
                            {DELIVERY_MODE_OPTIONS.map((option) => (
                              <option key={option.value || "empty"} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="field-block admin-supplier-select-field">
                          <span>Leverandør</span>
                          <select
                            value={value.supplierId || ""}
                            onChange={(event) =>
                              onSelectSupplier(
                                cityGroup.id,
                                question.id,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">Ingen valgt</option>
                            {suppliers.map((supplier) => (
                              <option key={supplier.id} value={supplier.id}>
                                {supplier.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="admin-weekday-list">
                          {DELIVERY_WEEKDAYS.map((day) => (
                            <label
                              key={`${cityGroup.id}-${question.id}-${day.value}`}
                              className="admin-weekday-chip"
                            >
                              <input
                                type="checkbox"
                                checked={value.deliveryDays.includes(day.value)}
                                disabled={supplierHasDefinedDeliveryDays}
                                onChange={() =>
                                  onToggleDeliveryDay(cityGroup.id, question.id, day.value)
                                }
                              />
                              <span>{day.label}</span>
                            </label>
                          ))}
                        </div>
                        {supplierHasDefinedDeliveryDays ? (
                          <p className="admin-muted admin-derived-delivery-text">
                            Leveringstid fra leverandør:{" "}
                            {formatDeliveryDayLabels(value.deliveryDays)}
                          </p>
                        ) : null}
                      </div>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default AdminLocations;
