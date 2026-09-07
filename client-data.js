/* ============================================================
   CRAIG YOUNG MUSIC — CLIENT PREVIEW & APPROVALS
   PER-CLIENT DATA  (edit only this file per client)
   ------------------------------------------------------------
   PRODUCTION PIPELINE — every track moves through 4 stages:
     1. raw     — client's recording comes in. YOU gate it.
                  raw: "received" | "accepted" | "rerecord"
                    received = in, not yet vetted
                    accepted = good to take into production
                    rerecord = client must re-record (shows them a flag)
     2. cleaned — you clean the vocal. Client APPROVES it.
     3. music   — you add suggested music. Client previews (optional note).
     4. final   — full production. Client gives FINAL approval.

   Per stage, a boolean = "is this stage ready for the client to see":
     cleaned:true/false   music:true/false   final:true/false
   (raw is the string above, not a boolean.)

   audio: filenames inside /audio for each stage's preview.
     audio:{ cleaned:"", music:"", final:"" }
     Leave "" and that stage shows "Preview coming soon" when ready.

   Client actions (approve / notes) are saved in their browser.
   ============================================================ */

window.CLIENT_DATA = {
  brand: {
    productName: "Craig Young Music",
    tagline: "Client Preview & Approvals",
    logoSrc: "cym-logo-gold-tp.png"
  },
  client: {
    name: "Boris Walter",
    project: "The Spiritual Sanctuary",
    preparedBy: "Craig Young",
    intro: "Here is your catalogue, tracked through every stage of production. You will approve the cleaned vocal, preview the music, and give the final sign-off on each piece. Anything you would like changed, add a note and I will take care of it."
  },
  contact: { method: "WhatsApp", label: "Copy my approvals to send to Craig" },

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
  ]
};

/* helper: build a track. raw = stage-1 gate string. cleaned/music/final = ready-for-client booleans. */
function t(title, raw, cleaned, music, final, induction, note){
  return {
    title: title,
    induction: induction || "no",
    endMusic: final ? "standard close" : "TBD",
    note: note || "",
    raw: raw,
    cleaned: !!cleaned,
    music: !!music,
    final: !!final,
    audio: { cleaned:"", music:"", final:"" }
  };
}

/* Demo preview wired so the player works out of the box (A River of Stars → final stage).
   Add real previews the same way: drop an mp3 in /audio and set the filename below. */
window.CLIENT_DATA.categories[0].tracks[0].audio.final = "a-river-of-stars.mp3";
