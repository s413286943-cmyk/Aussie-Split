# D15 Taronga Zoo Refresh Design

## Goal

Replace the existing D15 Manly plan with the supplied Taronga Zoo itinerary while preserving the booked Cafe Sydney farewell dinner and the existing Excel-backed import workflow.

## Content Scope

- Update D15 title, focus, transport, leave-by guidance, primary map, ticket resource, timeline, meal plan, and traveler notes.
- Use the supplied sequence: Circular Quay ferry, Taronga Zoo from about 10:00 to 13:30, CBD shopping, hotel TRS packing, and Cafe Sydney at 17:30.
- Remove D15 references to Manly Ferry, Manly Beach, Hugos Manly, and Felons Manly. Remove their resource rows only when no other itinerary day uses them.
- Keep D15 lodging, Cafe Sydney booking details, and D16 TRS preparation intact.

## Cover Direction

- Generate a new 16:9 bitmap cover with GPT Image.
- Use realistic editorial travel photography: Taronga Zoo giraffes in the foreground with Sydney Opera House and Harbour Bridge visible across the harbour.
- Keep the lower-left and lower-right regions readable for the existing D15 and date overlays.
- Save the final asset as `public/itinerary/d15-taronga-zoo-harbour.png` and reference it from the D15 Excel row with an accurate alt description.

## Data Flow

1. Edit `content/aussie-itinerary.xlsx`, which remains the source of truth.
2. Run the existing itinerary import to regenerate `src/data/itinerary.generated.json`.
3. Do not hand-edit generated JSON.

## Verification

- Confirm generated D15 data contains Taronga Zoo and no Manly references.
- Confirm D0-D16 links and Excel/generated-data parity still pass.
- Run tests, lint, and production build.
- Check the D15 card at desktop and mobile widths for readable text and correct cover framing.
