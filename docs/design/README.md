# Design reference

- `mock-screens.html` is the interactive mock and the visual source of truth. Open it in a browser. The bar at the top switches between Control, Help panel, Allow sheet, Approvals and Kiosk, and between light and dark. Everything is tappable.
- `screenshots/` holds captures of each view in light and dark, at desktop width and at 390px phone width.
- Fonts in the mock are subsets embedded for the demo only. For the build, self-host full font files: Lora (help panel titles and lead text) and Poppins (kiosk), both under the SIL Open Font Licence, for example from the `@fontsource/lora` and `@fontsource/poppins` packages. The parent app uses the iPhone system font.
- Sample data in the mock uses placeholder names (Ollie and Jamie). Replace with the household's real data at runtime.
