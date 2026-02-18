import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPenToSquare } from "@fortawesome/free-regular-svg-icons";
import { faLocationDot, faTruck } from "@fortawesome/free-solid-svg-icons";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { useAdminSession } from "../hooks/useAdminSession";
import "./Forms.css";
import "./Locations.css";
import foodtruck600 from "../assets/optimized/foodtruck-600.png";
import foodtruck1200 from "../assets/optimized/foodtruck-1200.png";

const emptyLocationForm = {
  name: "",
  address: "",
  weekdayHours: "",
  weekendHours: "",
  mapUrl: "",
  imageUrl: "",
  order: "",
};

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function sanitizeFileName(name) {
  return String(name || "image")
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-");
}

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

function getLocationErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "permission-denied") {
    return "Ingen tilgang til plasseringer. Sjekk admin-innlogging og Firestore-regler.";
  }
  if (code === "unauthenticated") {
    return "Du må være logget inn som admin for å lagre.";
  }
  if (code === "storage/unauthorized") {
    return "Ingen tilgang til bildeopplasting i Storage.";
  }
  if (code === "storage/canceled") {
    return "Opplastingen ble avbrutt.";
  }
  if (code === "storage/unknown") {
    return "Ukjent Storage-feil under opplasting.";
  }
  return code ? `${fallbackMessage} (${code})` : fallbackMessage;
}

function Locations() {
  const [locations, setLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [locationsError, setLocationsError] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newLocation, setNewLocation] = useState(emptyLocationForm);
  const [newImageFile, setNewImageFile] = useState(null);
  const [formState, setFormState] = useState({ saving: false, error: "" });
  const [editId, setEditId] = useState("");
  const [editLocation, setEditLocation] = useState(emptyLocationForm);
  const [editImageFile, setEditImageFile] = useState(null);
  const [editState, setEditState] = useState({ saving: false, error: "" });
  const { user, isAdmin, loading, error, signOutAdmin } = useAdminSession();

  useEffect(() => {
    const locationsQuery = query(collection(db, "locations"));
    const unsubscribe = onSnapshot(
      locationsQuery,
      (snapshot) => {
        const nextLocations = snapshot.docs.map((locationDoc) => ({
          id: locationDoc.id,
          ...locationDoc.data(),
        }));
        nextLocations.sort((a, b) => {
          const orderDiff = toSortOrder(a) - toSortOrder(b);
          if (orderDiff !== 0) {
            return orderDiff;
          }
          return String(a.name || "").localeCompare(String(b.name || ""), "nb");
        });
        setLocations(nextLocations);
        setLocationsError("");
        setLoadingLocations(false);
      },
      (err) => {
        console.error("Feil ved henting av locations:", err);
        setLocationsError(
          getLocationErrorMessage(
            err,
            "Kunne ikke hente plasseringer akkurat nå.",
          ),
        );
        setLoadingLocations(false);
      },
    );

    return unsubscribe;
  }, []);

  const hasLocations = useMemo(() => locations.length > 0, [locations]);

  function validateLocation(formData) {
    if (!formData.name.trim()) {
      return "Navn er påkrevd.";
    }
    if (!formData.address.trim()) {
      return "Adresse er påkrevd.";
    }

    const normalizedMapUrl = normalizeUrl(formData.mapUrl);
    if (normalizedMapUrl) {
      try {
        new URL(normalizedMapUrl);
      } catch {
        return "Kart-lenken er ikke gyldig.";
      }
    }
    return "";
  }

  async function onCreateLocation(event) {
    event.preventDefault();
    setFormState({ saving: false, error: "" });

    const validationError = validateLocation(newLocation);
    if (validationError) {
      setFormState({ saving: false, error: validationError });
      return;
    }

    setFormState({ saving: true, error: "" });
    try {
      let imageUrl = "";
      if (newImageFile) {
        const imagePath = `locations/images/${Date.now()}-${sanitizeFileName(newImageFile.name)}`;
        await uploadBytes(ref(storage, imagePath), newImageFile, {
          contentType: newImageFile.type || "image/jpeg",
        });
        imageUrl = await getDownloadURL(ref(storage, imagePath));
      }

      await addDoc(collection(db, "locations"), {
        name: newLocation.name.trim(),
        address: newLocation.address.trim(),
        weekdayHours: newLocation.weekdayHours.trim(),
        weekendHours: newLocation.weekendHours.trim(),
        mapUrl: normalizeUrl(newLocation.mapUrl),
        imageUrl,
        order: newLocation.order.trim() ? Number(newLocation.order) : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });
      setNewLocation(emptyLocationForm);
      setNewImageFile(null);
      setFormState({ saving: false, error: "" });
      setIsAddModalOpen(false);
    } catch (err) {
      console.error("Feil ved oppretting av location:", err);
      setFormState({
        saving: false,
        error: getLocationErrorMessage(
          err,
          "Kunne ikke legge til plassering. Prøv igjen.",
        ),
      });
    }
  }

  function onStartEdit(location) {
    setEditId(location.id);
    setEditLocation({
      name: location.name || "",
      address: location.address || "",
      weekdayHours: location.weekdayHours || "",
      weekendHours: location.weekendHours || "",
      mapUrl: location.mapUrl || "",
      imageUrl: location.imageUrl || "",
      order: location.order == null ? "" : String(location.order),
    });
    setEditImageFile(null);
    setEditState({ saving: false, error: "" });
  }

  async function onSaveEdit(event) {
    event.preventDefault();
    setEditState({ saving: false, error: "" });

    const validationError = validateLocation(editLocation);
    if (validationError) {
      setEditState({ saving: false, error: validationError });
      return;
    }

    setEditState({ saving: true, error: "" });
    try {
      let imageUrl = editLocation.imageUrl || "";
      if (editImageFile) {
        const imagePath = `locations/images/${Date.now()}-${sanitizeFileName(editImageFile.name)}`;
        await uploadBytes(ref(storage, imagePath), editImageFile, {
          contentType: editImageFile.type || "image/jpeg",
        });
        imageUrl = await getDownloadURL(ref(storage, imagePath));
      }

      await updateDoc(doc(db, "locations", editId), {
        name: editLocation.name.trim(),
        address: editLocation.address.trim(),
        weekdayHours: editLocation.weekdayHours.trim(),
        weekendHours: editLocation.weekendHours.trim(),
        mapUrl: normalizeUrl(editLocation.mapUrl),
        imageUrl,
        order: editLocation.order.trim() ? Number(editLocation.order) : null,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email || "admin",
      });
      setEditId("");
      setEditLocation(emptyLocationForm);
      setEditImageFile(null);
      setEditState({ saving: false, error: "" });
    } catch (err) {
      console.error("Feil ved oppdatering av location:", err);
      setEditState({
        saving: false,
        error: getLocationErrorMessage(
          err,
          "Kunne ikke oppdatere plassering. Prøv igjen.",
        ),
      });
    }
  }

  function closeAddModal() {
    setIsAddModalOpen(false);
    setNewLocation(emptyLocationForm);
    setNewImageFile(null);
    setFormState({ saving: false, error: "" });
  }

  return (
    <div className="locations-page">
      <header className="locations-hero">
        <div>
          <p className="eyebrow">Ti vogner - ett mål!</p>
          <h1>Finn en pizzavogn!</h1>
          <p className="lead">
            Våre 10 foodtrucks bringer Crust n' Trust til nabolag over hele Oslo
            - og litt utenfor! Ta turen innom for en smak av vår crusty pizza.
          </p>
        </div>
        <div className="locations-card">
          <h2>
            <FontAwesomeIcon icon={faTruck} /> 2026
          </h2>
          <ul>
            <li>10 aktive vogner</li>
            <li>Daglig servering</li>
            <li>Åpner fra 7. april og utover måneden!</li>
          </ul>
        </div>
      </header>

      <section className="locations-grid" aria-live="polite">
        {loadingLocations ? <p>Laster plasseringer...</p> : null}
        {locationsError ? (
          <p className="forms-error">{locationsError}</p>
        ) : null}
        {!loadingLocations && !hasLocations ? (
          <p>Ingen plasseringer lagt inn enda.</p>
        ) : null}

        {locations.map((location) => (
          <article key={location.id}>
            <img
              src={location.imageUrl || foodtruck600}
              srcSet={
                location.imageUrl
                  ? undefined
                  : `${foodtruck600} 600w, ${foodtruck1200} 1200w`
              }
              sizes="(max-width: 700px) 90vw, 320px"
              alt={`${location.name || "Crust foodtruck"} fasade`}
              loading="lazy"
              decoding="async"
            />
            <div className="location-meta">
              <h3>{location.name || "Uten navn"}</h3>
              {isAdmin ? (
                <button
                  type="button"
                  className="location-edit-icon"
                  aria-label="Rediger plassering"
                  onClick={() => onStartEdit(location)}
                >
                  <FontAwesomeIcon icon={faPenToSquare} />
                </button>
              ) : null}
            </div>
            <p className="location-neighborhood">
              <FontAwesomeIcon icon={faLocationDot} />{" "}
              {location.address || "Ukjent adresse"}
            </p>
            {location.weekdayHours ? <p>{location.weekdayHours}</p> : null}
            {location.weekendHours ? <p>{location.weekendHours}</p> : null}
            {location.mapUrl ? (
              <a
                className="ghost location-cta"
                href={location.mapUrl}
                target="_blank"
                rel="noreferrer"
              >
                Ta meg dit
              </a>
            ) : (
              <a
                className="ghost location-cta is-disabled"
                href="#"
                aria-disabled="true"
                tabIndex={-1}
              >
                Ta meg dit
              </a>
            )}
          </article>
        ))}
      </section>

      <section className={isAdmin ? "admin-box" : "admin-login-line"}>
        {loading ? <p>Kontrollerer innlogging...</p> : null}
        {error ? <p className="forms-error">{error}</p> : null}

        {isAdmin ? (
          <>
            <div className="admin-actions location-admin-actions">
              <p>Innlogget som {user?.email}</p>
              <div className="location-admin-controls">
                <button
                  type="button"
                  className="cta"
                  onClick={() => {
                    setFormState({ saving: false, error: "" });
                    setIsAddModalOpen(true);
                  }}
                >
                  Legg til plassering
                </button>
                <button
                  type="button"
                  className="ghost admin-logout-mini"
                  onClick={signOutAdmin}
                >
                  Logg ut
                </button>
              </div>
            </div>

            {isAddModalOpen ? (
              <div
                className="location-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="location-modal-title"
              >
                <div className="location-modal">
                  <form
                    className="locations-admin-form"
                    onSubmit={onCreateLocation}
                  >
                    <h3 id="location-modal-title">Legg til plassering</h3>

                    <label className="field-block" htmlFor="location-name">
                      <span>Navn</span>
                      <input
                        id="location-name"
                        type="text"
                        value={newLocation.name}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            name: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label className="field-block" htmlFor="location-address">
                      <span>Adresse</span>
                      <input
                        id="location-address"
                        type="text"
                        value={newLocation.address}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            address: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-weekday-hours"
                    >
                      <span>Åpningstid ukedag</span>
                      <input
                        id="location-weekday-hours"
                        type="text"
                        value={newLocation.weekdayHours}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            weekdayHours: event.target.value,
                          }))
                        }
                        placeholder="Man-Fre: 11:00-21:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-weekend-hours"
                    >
                      <span>Åpningstid helg</span>
                      <input
                        id="location-weekend-hours"
                        type="text"
                        value={newLocation.weekendHours}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            weekendHours: event.target.value,
                          }))
                        }
                        placeholder="Lør-Søn: 12:00-20:00"
                      />
                    </label>

                    <label className="field-block" htmlFor="location-map-url">
                      <span>Kart-lenke</span>
                      <input
                        id="location-map-url"
                        type="url"
                        value={newLocation.mapUrl}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            mapUrl: event.target.value,
                          }))
                        }
                        placeholder="https://maps.google.com/..."
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="location-image-file"
                    >
                      <span>Last opp bilde (valgfritt)</span>
                      <input
                        id="location-image-file"
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setNewImageFile(event.target.files?.[0] || null)
                        }
                      />
                    </label>

                    <label className="field-block" htmlFor="location-order">
                      <span>Rekkefølge (valgfritt tall)</span>
                      <input
                        id="location-order"
                        type="number"
                        inputMode="numeric"
                        value={newLocation.order}
                        onChange={(event) =>
                          setNewLocation((previous) => ({
                            ...previous,
                            order: event.target.value,
                          }))
                        }
                      />
                    </label>

                    {formState.error ? (
                      <p className="forms-error">{formState.error}</p>
                    ) : null}
                    <div className="location-edit-actions">
                      <button
                        type="submit"
                        className="cta"
                        disabled={formState.saving}
                      >
                        {formState.saving ? "Lagrer..." : "Publiser plassering"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={closeAddModal}
                      >
                        Lukk
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {editId ? (
              <div
                className="location-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="location-edit-modal-title"
              >
                <div className="location-modal">
                  <form className="locations-admin-form" onSubmit={onSaveEdit}>
                    <h3 id="location-edit-modal-title">Rediger plassering</h3>

                    <label className="field-block" htmlFor="edit-location-name">
                      <span>Navn</span>
                      <input
                        id="edit-location-name"
                        type="text"
                        value={editLocation.name}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            name: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-address"
                    >
                      <span>Adresse</span>
                      <input
                        id="edit-location-address"
                        type="text"
                        value={editLocation.address}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            address: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-weekday-hours"
                    >
                      <span>Åpningstid ukedag</span>
                      <input
                        id="edit-location-weekday-hours"
                        type="text"
                        value={editLocation.weekdayHours}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            weekdayHours: event.target.value,
                          }))
                        }
                        placeholder="Man-Fre: 11:00-21:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-weekend-hours"
                    >
                      <span>Åpningstid helg</span>
                      <input
                        id="edit-location-weekend-hours"
                        type="text"
                        value={editLocation.weekendHours}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            weekendHours: event.target.value,
                          }))
                        }
                        placeholder="Lør-Søn: 12:00-20:00"
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-map-url"
                    >
                      <span>Kart-lenke</span>
                      <input
                        id="edit-location-map-url"
                        type="url"
                        value={editLocation.mapUrl}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            mapUrl: event.target.value,
                          }))
                        }
                        placeholder="https://maps.google.com/..."
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-image-file"
                    >
                      <span>Last opp nytt bilde (valgfritt)</span>
                      <input
                        id="edit-location-image-file"
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          setEditImageFile(event.target.files?.[0] || null)
                        }
                      />
                    </label>

                    <label
                      className="field-block"
                      htmlFor="edit-location-order"
                    >
                      <span>Rekkefølge (valgfritt tall)</span>
                      <input
                        id="edit-location-order"
                        type="number"
                        inputMode="numeric"
                        value={editLocation.order}
                        onChange={(event) =>
                          setEditLocation((previous) => ({
                            ...previous,
                            order: event.target.value,
                          }))
                        }
                        placeholder="1"
                      />
                    </label>

                    {editState.error ? (
                      <p className="forms-error">{editState.error}</p>
                    ) : null}
                    <div className="location-edit-actions">
                      <button
                        type="submit"
                        className="cta"
                        disabled={editState.saving}
                      >
                        {editState.saving ? "Lagrer..." : "Lagre endringer"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setEditId("");
                          setEditLocation(emptyLocationForm);
                          setEditImageFile(null);
                          setEditState({ saving: false, error: "" });
                        }}
                      >
                        Avbryt
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

export default Locations;
