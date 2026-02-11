import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { defaultStengeskjema } from "../forms/defaultForms";
import { useAdminSession } from "../hooks/useAdminSession";
import "./Forms.css";

const defaultFormsBySlug = {
  [defaultStengeskjema.slug]: defaultStengeskjema,
};

function Forms() {
  const navigate = useNavigate();
  const [forms, setForms] = useState([defaultStengeskjema]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState("");
  const [newFormSlug, setNewFormSlug] = useState("");
  const [newFormTitle, setNewFormTitle] = useState("");
  const [createState, setCreateState] = useState({
    creating: false,
    error: "",
  });
  const [deleteTargetSlug, setDeleteTargetSlug] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteState, setDeleteState] = useState({
    deleting: false,
    error: "",
    message: "",
  });
  const { user, isAdmin, loading, error, signOutAdmin } = useAdminSession();

  useEffect(() => {
    let cancelled = false;

    async function loadForms() {
      setFormsError("");
      try {
        const snapshot = await getDocs(collection(db, "forms"));
        const bySlug = new Map([
          [defaultStengeskjema.slug, defaultStengeskjema],
        ]);

        snapshot.forEach((item) => {
          const data = item.data();
          if (!data?.slug) {
            return;
          }
          const defaultForSlug = defaultFormsBySlug[data.slug] || {};
          bySlug.set(data.slug, {
            ...defaultForSlug,
            id: item.id,
            ...data,
          });
        });

        if (!cancelled) {
          const merged = Array.from(bySlug.values()).sort((a, b) =>
            (a.title || "").localeCompare(b.title || "", "nb"),
          );
          setForms(merged);
        }
      } catch {
        if (!cancelled) {
          setFormsError("Kunne ikke hente skjema akkurat nå.");
        }
      } finally {
        if (!cancelled) {
          setLoadingForms(false);
        }
      }
    }

    loadForms();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleForms = useMemo(
    () =>
      forms.filter(
        (form) => typeof form.slug === "string" && form.slug.length > 0,
      ),
    [forms],
  );
  const deletableForms = useMemo(() => visibleForms, [visibleForms]);

  async function onCreateForm(event) {
    event.preventDefault();
    setCreateState({ creating: false, error: "" });

    const normalizedSlug = newFormSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!normalizedSlug) {
      setCreateState({ creating: false, error: "Oppgi en gyldig URL-del." });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
      setCreateState({
        creating: false,
        error: "URL-del kan kun inneholde små bokstaver, tall og bindestrek.",
      });
      return;
    }

    if (visibleForms.some((form) => form.slug === normalizedSlug)) {
      setCreateState({
        creating: false,
        error: "Et skjema med denne URL-en finnes allerede.",
      });
      return;
    }

    const title = newFormTitle.trim() || normalizedSlug;

    setCreateState({ creating: true, error: "" });
    try {
      await setDoc(doc(db, "forms", normalizedSlug), {
        slug: normalizedSlug,
        title,
        description: "",
        questions: [
          {
            id: "navn",
            label: "Navn",
            type: "name",
            required: true,
            placeholder: "",
          },
        ],
        updatedAt: serverTimestamp(),
      });

      navigate(`/skjema/${normalizedSlug}`);
    } catch {
      setCreateState({
        creating: false,
        error: "Kunne ikke opprette skjema. Prøv igjen.",
      });
    }
  }

  async function onDeleteForm(event) {
    event.preventDefault();
    setDeleteState({ deleting: false, error: "", message: "" });

    const targetSlug = deleteTargetSlug.trim().toLowerCase();
    if (!targetSlug) {
      setDeleteState({
        deleting: false,
        error: "Velg et skjema å slette.",
        message: "",
      });
      return;
    }

    const requiredConfirmation = `SLETT ${targetSlug}`;
    if (deleteConfirmText.trim() !== requiredConfirmation) {
      setDeleteState({
        deleting: false,
        error: `Skriv "${requiredConfirmation}" for å bekrefte.`,
        message: "",
      });
      return;
    }

    const targetForm = visibleForms.find((form) => form.slug === targetSlug);
    if (!targetForm) {
      setDeleteState({
        deleting: false,
        error: "Fant ikke valgt skjema.",
        message: "",
      });
      return;
    }

    setDeleteState({ deleting: true, error: "", message: "" });
    try {
      await deleteDoc(doc(db, "forms", targetForm.id || targetSlug));
      setForms((previous) =>
        previous.filter((form) => form.slug !== targetSlug),
      );
      setDeleteTargetSlug("");
      setDeleteConfirmText("");
      setDeleteState({
        deleting: false,
        error: "",
        message: `Skjema "${targetSlug}" er slettet.`,
      });
    } catch {
      setDeleteState({
        deleting: false,
        error: "Kunne ikke slette skjema. Prøv igjen.",
        message: "",
      });
    }
  }

  return (
    <div className="forms-page">
      <header className="forms-hero">
        <p className="eyebrow">Skjemaer</p>
        <h1>Velg skjema</h1>
        <p className="lead">
          Her kan alle fylle ut skjemaer. Admin kan i tillegg redigere skjema og
          se innsendinger.
        </p>
      </header>

      <section className="forms-grid" aria-live="polite">
        {loadingForms ? <p>Laster skjema...</p> : null}
        {formsError ? <p className="forms-error">{formsError}</p> : null}

        {!loadingForms &&
          visibleForms.map((form) => (
            <article key={form.slug} className="form-card">
              <h2>{form.title || form.slug}</h2>
              <p>{form.description || "Ingen beskrivelse enda."}</p>
              <div className="form-card-actions">
                <Link className="cta" to={`/skjema/${form.slug}`}>
                  Åpne skjema
                </Link>
                {isAdmin ? (
                  <>
                    <Link
                      className="ghost"
                      to={`/skjema/${form.slug}/submissions`}
                    >
                      Submissions
                    </Link>
                    <Link className="ghost" to={`/skjema/${form.slug}/edit`}>
                      Edit form
                    </Link>
                  </>
                ) : null}
              </div>
            </article>
          ))}
      </section>

      <section className={isAdmin ? "admin-box" : "admin-login-line"}>
        {loading ? <p>Kontrollerer innlogging...</p> : null}
        {error ? <p className="forms-error">{error}</p> : null}
        {isAdmin ? (
          <>
            <div className="admin-session">
              <p>Innlogget som {user?.email}</p>
            </div>
            <div className="admin-actions">
              <Link className="cta" to="/skjema/stengeskjema/edit">
                Administrer stengeskjema
              </Link>
            </div>

            <form className="admin-create-form" onSubmit={onCreateForm}>
              <h3>Opprett nytt skjema</h3>
              <label className="field-block" htmlFor="new-form-slug">
                <span>URL-del (blir `/skjema/[url]`)</span>
                <input
                  id="new-form-slug"
                  type="text"
                  value={newFormSlug}
                  onChange={(event) => setNewFormSlug(event.target.value)}
                  placeholder="f.eks. ukesrapport"
                  required
                />
              </label>

              <label className="field-block" htmlFor="new-form-title">
                <span>Tittel (valgfritt)</span>
                <input
                  id="new-form-title"
                  type="text"
                  value={newFormTitle}
                  onChange={(event) => setNewFormTitle(event.target.value)}
                  placeholder="f.eks. Ukesrapport"
                />
              </label>

              {createState.error ? (
                <p className="forms-error">{createState.error}</p>
              ) : null}

              <button
                type="submit"
                className="cta"
                disabled={createState.creating}
              >
                {createState.creating ? "Oppretter..." : "Opprett skjema"}
              </button>
            </form>

            <form className="admin-delete-form" onSubmit={onDeleteForm}>
              <h3>Slett skjema</h3>
              <p className="delete-help">Sletting er permanent.</p>

              <label className="field-block" htmlFor="delete-form-slug">
                <span>Velg skjema</span>
                <select
                  id="delete-form-slug"
                  value={deleteTargetSlug}
                  onChange={(event) => setDeleteTargetSlug(event.target.value)}
                  required
                >
                  <option value="">Velg skjema</option>
                  {deletableForms.map((form) => (
                    <option key={form.slug} value={form.slug}>
                      {form.title || form.slug} ({form.slug})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block" htmlFor="delete-form-confirmation">
                <span>
                  Bekreft ved å skrive{" "}
                  <code>
                    {deleteTargetSlug
                      ? `SLETT ${deleteTargetSlug}`
                      : "SLETT [slug]"}
                  </code>
                </span>
                <input
                  id="delete-form-confirmation"
                  type="text"
                  value={deleteConfirmText}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                  placeholder={
                    deleteTargetSlug
                      ? `SLETT ${deleteTargetSlug}`
                      : "SLETT [slug]"
                  }
                  required
                />
              </label>

              {deleteState.error ? (
                <p className="forms-error">{deleteState.error}</p>
              ) : null}
              {deleteState.message ? (
                <p className="forms-success">{deleteState.message}</p>
              ) : null}

              <button
                type="submit"
                className="ghost danger-button"
                disabled={deleteState.deleting || deletableForms.length === 0}
              >
                {deleteState.deleting ? "Sletter..." : "Slett skjema"}
              </button>

              <div className="admin-logout-divider">
                <button
                  type="button"
                  className="ghost admin-logout-mini"
                  onClick={signOutAdmin}
                >
                  Logg ut
                </button>
              </div>
            </form>
          </>
        ) : (
          <p>
            Admin-innlogging er flyttet til <Link to="/admin">/admin</Link>.
          </p>
        )}
      </section>
    </div>
  );
}

export default Forms;
