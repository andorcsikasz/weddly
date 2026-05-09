> **DRAFT — not legal advice.** This is a starting template based on the data
> Weddly actually collects. A Hungarian privacy lawyer must review it before
> launch. Replace every {{PLACEHOLDER}}.

# Adatkezelési tájékoztató / Privacy Policy

**Hatályos / Effective:** {{EFFECTIVE_DATE}}
**Adatkezelő / Data controller:** {{COMPANY_NAME}} ({{COMPANY_REG_NUMBER}}), {{COMPANY_ADDRESS}}
**Kapcsolat / Contact:** {{PRIVACY_EMAIL}}

---

## 1. Mit gyűjtünk és miért / What we collect and why

| Adatkör / Data | Cél / Purpose | Jogalap / Legal basis (GDPR) |
|---|---|---|
| E-mail, jelszó-hash, név | Fiókkezelés, autentikáció | Szerződés teljesítése — Art. 6(1)(b) |
| Esküvő dátuma, vendéglétszám, költségkeret, helyszín | A megrendelt szolgáltatás (tervezés) | Szerződés teljesítése |
| Vendéglista (név, e-mail, telefon, étrend, szállás-igény, kísérő) | RSVP és ültetésszervezés a pár nevében | Szerződés teljesítése; a vendégek adatait a pár adja meg, a Weddly adatfeldolgozóként kezeli |
| Auditnapló (ki mit változtatott, mikor) | Visszaélés-megelőzés, jogi vita esetén bizonyíték | Jogos érdek — Art. 6(1)(f) |
| IP-cím (átmeneti, csak rate-limit) | Visszaélés-megelőzés (brute-force védelme) | Jogos érdek |
| Hibanaplók (Sentry, ha aktív) | Üzemeltetési hibajavítás | Jogos érdek |
| Webanalitika (Plausible, ha aktív) | Forgalom-mérés cookie nélkül, nem azonosító módon | Jogos érdek |

**Nem gyűjtünk:** sütiken alapuló követés, harmadik feles hirdetés, biometria,
helymeghatározás (csak amit a páros maga ad meg az esküvő helyszínéhez).

## 2. Meddig őrizzük / Retention

- **Aktív munkaterület:** amíg a páros nem kéri a törlést.
- **Szüneteltetett (pause) munkaterület:** 30 nap múlva PII törlődik. Az auditnapló és a páros sor metaadata megmarad jogi/adóretenció miatt.
- **Auditnapló:** 5 évig (számviteli tv. analógiájára, felülvizsgálandó).
- **Hibanaplók:** Sentry default retention (jellemzően 30/90 nap).

## 3. Kinek adjuk át / Sub-processors

- **Railway** (USA) — hosting, EU GDPR DPA-val.
- **Resend** (USA) — tranzakciós e-mail, EU SCC-vel.
- **Sentry** (USA, ha aktív) — hibanapló, EU SCC-vel.
- **Plausible** (EU, ha aktív) — analitika, sütik nélkül.
- **{{S3_PROVIDER}}** — titkosított DB-mentések tárolása.

A v2 marketplace bevezetésekor a beszállítóknak átadott adatkörök külön kerülnek listázásra.

## 4. Jogaid / Your rights (GDPR)

- **Hozzáférés / access:** a Beállítások → "JSON letöltése" gombbal egy lépésben letölthető a teljes munkaterület.
- **Helyesbítés / rectification:** közvetlenül szerkeszthető a felületen.
- **Törlés / erasure:** Beállítások → "Munkaterület szüneteltetése" indít egy 30 napos folyamatot.
- **Adathordozhatóság / portability:** az export JSON gépi olvasásra kész.
- **Hozzájárulás visszavonása / withdrawal:** {{PRIVACY_EMAIL}}
- **NAIH-panasz / supervisory complaint:** Nemzeti Adatvédelmi és Információszabadság Hatóság, https://naih.hu

## 5. Vendégek adatai / Guest data

A vendégek adatait a páros viszi fel. A Weddly ezek tekintetében **adatfeldolgozó**
(processor); a páros az adatkezelő. Vendégtörlést a páros tud kezdeményezni a
felületen, vagy a vendég közvetlenül a {{PRIVACY_EMAIL}} címen.

## 6. Biztonság / Security

- Jelszók Argon2id-val hash-elve, soha plain-text formában.
- Adatbázis-mentések titkosítva (age) és S3-kompatibilis tárolóra feltöltve.
- TLS 1.2+ kötelező; HSTS bekapcsolva.
- Tartalombiztonsági szabályzat (CSP), klikkelés-elleni védelem (X-Frame-Options: DENY).

## 7. Változtatás / Changes

A jelentős változásokat a hatálybalépés előtt 14 nappal e-mailben jelezzük a
fiókhoz tartozó címekre.

---

## English summary

This is a Hungarian-first service. The above is the binding text. Key points in
English: Weddly stores your account, wedding details, and guest list to provide
the planning service (Art. 6(1)(b) GDPR). Audit logs and rate-limit IPs are kept
for security (Art. 6(1)(f)). You can export your data as JSON and request
deletion at any time via Settings → Pause Workspace (30-day window). Sub-processors:
Railway, Resend, Sentry (optional), Plausible (optional). Contact: {{PRIVACY_EMAIL}}.
