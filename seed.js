/* Initial catalogue seed. Written to the data store on first run only.
   After that, the live data lives in <DATA_DIR>/data.json and is edited
   through the admin UI (uploads, stage toggles, status). Editing this file
   does NOT change an already-seeded store. */

function t(title, raw, cleaned, music, final, induction, note){
  return {
    title: title,
    induction: induction || "no",
    endMusic: final ? "standard close" : "TBD",
    note: note || "",
    raw: raw,                 // "received" | "accepted" | "rerecord"
    cleaned: !!cleaned,       // stage ready-for-client flags
    music: !!music,
    final: !!final,
    audio: { raw:"", cleaned:"", music:"", final:"" }
  };
}

module.exports = {
  brand: { productName: "Craig Young Music", tagline: "Client Preview & Approvals", logoSrc: "cym-logo-gold-tp.png" },
  client: {
    name: "Boris Walter",
    project: "The Spiritual Sanctuary",
    preparedBy: "Craig Young",
    intro: "Here is your catalogue, tracked through every stage of production. You will approve the cleaned vocal, preview the music, and give the final sign-off on each piece. Anything you would like changed, add a note and I will take care of it."
  },
  contact: { method: "WhatsApp" },
  categories: [
    {
      name: "Spiritual Stories",
      subtitle: "The Velvet Dream Hour",
      tracks: [
        t("A River of Stars",                 "accepted", true,  true,  true),
        t("The Seeker's Burden",              "accepted", true,  true,  false),
        t("The Whisper of the Infinite Now",  "accepted", false, false, false),
        t("The Home Beyond the Stars",        "accepted", false, false, false),
        t("The Stillness Beneath the Circus", "accepted", false, false, false),
        t("The Orchid of Unseen Winds",       "accepted", false, false, false)
      ]
    },
    {
      name: "Spiritual Readings",
      subtitle: "Voices of the Timeless Ancients — sacred texts",
      subcategories: [
        {
          name: "Bhagavad Gita",
          tracks: [
            t("Soul's Immortality",              "accepted", true,  true,  true),
            t("Divine Care for the Devoted",     "accepted", true,  true,  true),
            t("Duty and Dharma",                 "accepted", true,  true,  true),
            t("Qualities of the Devoted",        "accepted", true,  true,  true),
            t("Seeing the Divine in All Beings", "accepted", true,  true,  true),
            t("Self Elevation Through Mind Mastery", "accepted", false, false, false),
            t("The Art of Detached Action",      "accepted", false, false, false),
            t("The Eternal Sound as a Fragment of the Divine", "accepted", false, false, false),
            t("The Self in All Hearts",          "accepted", false, false, false),
            t("The Supreme Surrender",           "accepted", false, false, false),
            t("Gita Induction",                  "received", false, false, false, "yes", "Opens the Gita series for the practitioner tier.")
          ]
        },
        {
          name: "Marcus Aurelius",
          tracks: [
            t("Power Over the Mind",              "accepted", true,  true,  true),
            t("Confine Yourself to the Present",  "accepted", false, false, false),
            t("Enjoy the Privilege of Life",      "accepted", false, false, false),
            t("Fearlessness in Life",             "accepted", false, false, false),
            t("Look Within",                      "accepted", false, false, false),
            t("The Beauty of Life",               "accepted", false, false, false),
            t("The Ethics of Truth",              "accepted", false, false, false),
            t("The Quality of Your Thoughts",     "accepted", false, false, false),
            t("Thoughts Colour the Soul",         "accepted", false, false, false),
            t("Your Relationship with Fate",      "accepted", false, false, false),
            t("Spoken Passage (Book 4, Section 3)","received", false, false, false, "no", "Title may need confirming against your original script.")
          ]
        }
      ]
    }
  ],
  // demo preview wired so the player works before any upload
  demoAudio: { "a-river-of-stars": { final: "a-river-of-stars.mp3" } }
};
