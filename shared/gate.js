// The login screen. Every page loads this first: until the password has been entered in this tab, the page is hidden and
// a password form is shown. This is a gate in the browser, not access control: the pages and data files are static
// files, and anyone who requests them directly gets them. Only a hash of the password is kept here.
(() => {
  const HASH = "33b61bb5009bfb74552d996e45eaa2a860487091d6aa4171363c4b508571d6cd";
  const KEY = "marin-budget-unlocked";
  const open = () => { try { return window.sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  if (open()) return;
  document.documentElement.setAttribute("data-locked", "");

  const sha256 = async (text) => {
    const bytes = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const draw = () => {
    const form = document.createElement("form");
    form.className = "gate app-card";
    form.setAttribute("aria-labelledby", "gate-title");
    form.noValidate = true;
    form.innerHTML =
      '<h1 id="gate-title" class="gate__title">Marin Budget</h1>' +
      '<label for="gate-password">Password</label>' +
      '<input type="password" id="gate-password" name="password" autocomplete="current-password" required aria-describedby="gate-error">' +
      '<p id="gate-error" class="gate__error" role="alert" hidden>Incorrect password.</p>' +
      '<button type="submit" class="gate__button">Log in</button>';
    document.body.append(form);
    const input = form.querySelector("input");
    const error = form.querySelector("#gate-error");
    input.focus();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.hidden = true;
      input.removeAttribute("aria-invalid");
      let ok = false;
      try { ok = (await sha256(input.value)) === HASH; } catch (e) { ok = false; }
      if (!ok) {
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.select();
        return;
      }
      try { window.sessionStorage.setItem(KEY, "1"); } catch (e) { /* the page opens for this load only */ }
      window.location.reload();
    });
  };
  if (document.body) draw(); else document.addEventListener("DOMContentLoaded", draw);
})();
