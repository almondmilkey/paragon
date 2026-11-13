# Paragon – wersja niezależna

Aplikacja działa w przeglądarce telefonu i instaluje się na ekranie głównym (PWA). Użytkownicy zakładają konto e-mail + hasło, a Claude nie jest nikomu potrzebny. Skanowanie idzie przez Twój klucz API, ukryty na serwerze.

```
Telefon (GitHub Pages)  ──►  Supabase, Frankfurt (UE)
  index.html, app.js           • konta (e-mail + hasło)
                               • baza danych: paragony, ustawienia, licznik skanów
                               • funkcja scan-receipt  ──►  Anthropic API (odczyt zdjęcia)
                               • funkcja delete-account
```

## Co jest w paczce

| Plik / folder | Do czego |
|---|---|
| `index.html`, `styles.css`, `app.js` | aplikacja |
| `config.js` | **tu wpisujesz** adres i klucz Supabase |
| `manifest.webmanifest`, `sw.js`, `icons/` | instalacja na telefonie |
| `fonts/`, `vendor/` | czcionki i biblioteka Supabase trzymane lokalnie (bez Google Fonts, ze względu na RODO) |
| `privacy.html` | **szkic** polityki prywatności do uzupełnienia |
| `supabase/schema.sql` | tabele bazy danych i zabezpieczenia |
| `supabase/functions/…` | dwie funkcje serwerowe |

Szacowany czas pierwszej konfiguracji: ok. 1–1,5 godziny. Nazwy przycisków w panelach Supabase, Anthropic i GitHub mogą się trochę różnić od opisu, bo te serwisy czasem zmieniają wygląd.

---

## Krok 1. Supabase: projekt i baza danych

1. Załóż konto na **supabase.com** → **New project**.
2. Wpisz nazwę `paragon`, wymyśl hasło do bazy (zapisz je) i wybierz region **Central EU (Frankfurt)**. Plan: **Free**.
3. Gdy projekt się utworzy: **SQL Editor** → **New query** → wklej całą zawartość `supabase/schema.sql` → **Run**. Powinno się pojawić „Success”.
4. **Authentication → Sign In / Providers → Email**: włączone, **Confirm email** włączone.

> Darmowy projekt usypia się po tygodniu bez żadnej aktywności. Odblokowujesz go jednym kliknięciem w panelu. Gdy pojawią się prawdziwi użytkownicy, przejdź na plan Pro.

## Krok 2. Anthropic: klucz API (do skanowania)

To osobne konto od Claude.ai.

1. Wejdź na **console.anthropic.com** i załóż konto.
2. **Billing**: doładuj małą kwotę, np. 5–10 $ (to wystarczy na setki skanów).
3. **Limits**: ustaw **miesięczny limit wydatków**, np. 10 $. To Twój bezpiecznik.
4. **API Keys → Create Key**, nazwij go `paragon` i skopiuj. Klucz zaczyna się od `sk-ant-` i widzisz go tylko raz.

> Klucza **nigdy** nie wklejaj do `config.js` ani na GitHuba. Trafia tylko do Supabase (krok 3).

## Krok 3. Supabase: funkcje serwerowe i sekrety

1. W Supabase: **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nazwa: `scan-receipt`. Usuń przykładowy kod, wklej całość `supabase/functions/scan-receipt/index.ts` i kliknij **Deploy**.
3. Powtórz dla funkcji `delete-account` (plik `supabase/functions/delete-account/index.ts`).
4. **Edge Functions → Secrets** (albo **Project Settings → Edge Functions**) i dodaj:

| Nazwa | Wartość |
|---|---|
| `ANTHROPIC_API_KEY` | klucz z kroku 2 |
| `SCAN_LIMIT_PER_MONTH` | `50` (skany na użytkownika miesięcznie, zmienisz kiedy chcesz) |
| `ANTHROPIC_MODEL` | opcjonalnie; domyślnie `claude-haiku-4-5` (tani i szybki). Jeśli zobaczysz za dużo błędów odczytu, wpisz nazwę mocniejszego modelu z dokumentacji Anthropic (rodzina Sonnet), ok. 3× drożej |

`ALLOWED_ORIGIN` dodasz w kroku 5.

## Krok 4. config.js

W Supabase: **Project Settings → API** (albo **API Keys**). Skopiuj:

- **Project URL** (np. `https://abcdxyz.supabase.co`),
- klucz **anon** albo **publishable**.

Wpisz oba w `config.js`.

> Te dwie wartości mogą być publiczne: baza wpuszcza każdego tylko do jego własnych danych. **Nigdy** nie wpisuj tam klucza `service_role` ani `secret`.

## Krok 5. GitHub Pages: publikacja

1. Na GitHubie: **New repository** → nazwa `paragon` → **Public** → Create.
2. **Add file → Upload files** → przeciągnij **zawartość** folderu `paragon-app` (pliki i foldery, a nie sam folder) → **Commit changes**.
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
4. Po 1–2 minutach aplikacja jest pod adresem `https://TWOJ-LOGIN.github.io/paragon/`.

Teraz wróć do Supabase:

- **Authentication → URL Configuration**:
  - Site URL: `https://TWOJ-LOGIN.github.io/paragon/`
  - Redirect URLs: dodaj ten sam adres.
  Dzięki temu linki z maili (potwierdzenie konta, reset hasła) prowadzą do aplikacji.
- **Edge Functions → Secrets**: dodaj `ALLOWED_ORIGIN` = `https://TWOJ-LOGIN.github.io` (bez `/paragon` na końcu).

> Repozytorium jest publiczne, ale nie ma w nim żadnych sekretów. GitHub Pages z prywatnego repozytorium wymaga płatnego planu GitHub. Darmowa alternatywa z prywatnym repo: Cloudflare Pages albo Netlify.

## Krok 6. Instalacja na telefonie

- **iPhone (Safari)**: otwórz adres → przycisk Udostępnij → **Do ekranu początkowego**.
- **Android (Chrome)**: otwórz adres → menu ⋮ → **Zainstaluj aplikację** / **Dodaj do ekranu głównego**.

Znajomym wysyłasz po prostu link.

## Test po instalacji

- [ ] Załóż konto → przyjdzie mail → kliknij link → zaloguj się.
- [ ] Widać dane przykładowe z etykietą „Example data”.
- [ ] Zeskanuj paragon → popraw nazwę produktu → zapisz. Dane przykładowe znikają.
- [ ] W **Table Editor → receipts** widać zapisany paragon, a w **scan_usage** licznik 1.
- [ ] Dodaj wydatek ręcznie, edytuj go i usuń.
- [ ] **Settings → Send feedback** opens the email app with `info@mijnparagon.nl` as the recipient. This uses a `mailto:` link, so no additional Supabase or SMTP setup is needed; the user's device must have an email app configured, and the user still presses Send.
- [ ] Ustawienia → Export CSV otwiera plik.
- [ ] „Forgot password?” → mail → nowe hasło działa.
- [ ] Na drugim koncie nie widać danych pierwszego.

## Aktualizacje

Zmieniasz pliki na GitHubie (ikona ołówka albo ponowny upload). W `sw.js` podnieś `VERSION` (np. `paragon-v2`), żeby telefony pobrały nową wersję. Czasem trzeba zamknąć i otworzyć aplikację dwa razy.

## Koszty (stan: szacunek)

| Pozycja | Koszt |
|---|---|
| GitHub Pages | 0 € |
| Supabase Free | 0 € (500 MB bazy ≈ 250 tys. paragonów; zdjęcia nie są przechowywane) |
| Skan (Haiku) | ok. 0,5–0,7 centa za paragon |
| Bezpieczniki | limit skanów na użytkownika (`SCAN_LIMIT_PER_MONTH`) + limit wydatków w konsoli Anthropic |

Nieudany skan (błąd, „to nie paragon”) nie zjada użytkownikowi limitu.

## Zanim zaprosisz obce osoby

1. **Maile**: wbudowana wysyłka Supabase pozwala tylko na kilka maili na godzinę. Podłącz własny serwer pocztowy: **Authentication → SMTP Settings**, np. darmowy plan Resend albo Brevo.
2. **privacy.html**: uzupełnij pola w [nawiasach] i usuń żółtą ramkę.
3. **Impressum**: w Niemczech strona prowadzona w celach zarobkowych go wymaga. Jeśli zaczniesz pobierać opłaty, dodaj stronę `impressum.html` i skonsultuj szczegóły.
4. **Umowy powierzenia (DPA)**: zaakceptuj DPA Supabase (w ustawieniach organizacji) i sprawdź warunki przetwarzania danych Anthropic (zdjęcie paragonu jest przetwarzane w USA).

## Gdy coś nie działa

| Objaw | Co sprawdzić |
|---|---|
| „Paragon isn't connected to its database yet” | `config.js` nie jest uzupełniony |
| Link z maila prowadzi na `localhost` | Site URL / Redirect URLs (krok 5) |
| Skan: „Something went wrong” | Edge Functions → `scan-receipt` → **Logs**; najczęściej brak `ANTHROPIC_API_KEY`, brak środków albo przekroczony limit wydatków |
| Skan blokowany w przeglądarce (CORS) | `ALLOWED_ORIGIN` musi być dokładnie `https://login.github.io` |
| Nie przychodzą maile | limit wbudowanej poczty, patrz „Zanim zaprosisz obce osoby” pkt 1 |
