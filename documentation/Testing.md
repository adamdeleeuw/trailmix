# Testing

## 1. Change History

| **Change Date**   | **Modified Sections** | **Rationale** |
| ----------------- | --------------------- | ------------- |
| 2026-10-15        | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | Added the sign-in, sign-out and "get my account" API tests (issue #9) |
| 2026-10-16        | 2.1.2, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1 | Added the CI run and coverage screenshots, the coverage upload to Codacy, the error-handler branch API tests can't reach, and the real front-end test location (issue #9) |
| 2026-10-16        | 2.1.1, 2.1.3, 2.6 | Added the vehicle list and "save my profile" API tests, and labelled each HTML coverage report with its run (issue #10) |
| 2026-10-16        | 2.1.2, 2.2, 2.3, 2.4, 2.5 | Updated the CI run and coverage screenshots and the commit the tests run on for issue #10 |
| 2026-10-19        | 2.1.1, 2.6 | Added the chained route API tests (issue #7) |
| 2026-10-19        | 2.1.1, 2.6 | Added the "save my gas price" and "delete my account" API tests (issue #11) |
| 2026-10-19        | 2.1.1 | The "delete my account" tests now check that the user's trips are deleted, and mock a Trip DB failure |
| 2026-10-19        | 2.1.1, 2.5, 2.6 | Added the "get my trips" API tests for the trip history feature (PR #20), and listed the trip total checks API tests can't reach |
| 2026-10-20        | 2.1.1, 2.1.2, 2.1.3, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 4.2 | Added the demo trips API tests (PR #24), updated the commit the tests run on and the CI run and coverage screenshots for CP1, switched the install step to `npm ci`, and marked the non-functional and front-end test specifications as coming in a later checkpoint |
| 2026-11-01        | 2.1.1, 2.6, 4.1 | Added the parking spot API tests (issue #71). The "delete my account" tests now check that the user's parking spots are deleted. Added the Map tab's unit tests |
| 2026-11-01        | 2.1.1, 2.6 | Removed the `POST /api/users/me/trips/seed` API tests along with the endpoint and the Map tab's "Load demo trips" button, and updated the `trip.model.ts` coverage note, since no API saves trips now |
| 2026-11-01        | 4.1 | `ParkingSpotsViewModelTest` now also covers tapping a place or a P marker on the map, including the address lookup and its fallback (issue #71) |
| 2026-11-02        | 2.1.1, 2.6, 3.1, 3.2 | Added the Planner endpoint, pure algorithm tests, saved planning preferences, and the response-time NFR test (issue #72) |
| 2026-11-04        | 2.1.1, 2.6, 4.1 | Added the save, status change and delete trip API tests (issue #74), and removed the `trip.model.ts` coverage note, since saving a trip now reaches the total checks. A trip's total time may now be more than its legs (it includes waiting, as the Planner sends it). Added the trip lifecycle, History totals and Navigation unit tests. Routes and saved trips now carry turn-by-turn steps for in-app navigation and a transit line's short name, with planner, save and `normalizeRouteLegs` tests for them |
| 2026-11-04        | 2.1.1, 2.1.2, 2.1.3, 2.5, 2.6, 3, 4 | CP2 write-up after the Planner (#72), Planning and Trip Preview (#73) and the trip lifecycle (#74) merged into `main`. Removed the `POST /api/routes/chained` row with the endpoint and its tests, added line anchors to the Planner rows, updated the commit the tests run on, and explained the skipped live Google test. Updated the coverage gaps from the new combined run, and listed the Planner lines that aren't covered yet instead of calling them unreachable. Rewrote the NFR section from a new run on Node 22, and added the Plan Multimodal Trip and Preview Route end-to-end test (`PlanTripTest`), with each use-case step mapped to the test's steps |
| 2026-11-04        | 2.1.1, 2.1.2, 2.5, 2.6, 3.1, 3.2 | Added API tests for the Planner lines that weren't covered (#82), so every Planner line and function is covered except two the API can't reach, now listed in 2.6 with the Planner branches still not exercised. Updated the coverage, the commit the tests run on, the NFR log, and the line links that moved |

---

## 2. Back-end Test Specification: APIs

### 2.1. Locations of Back-end Tests and Instructions to Run Them

#### 2.1.1. Tests

Unit tests for the Planner's own logic and for merging a route's walking legs are in `backend/tests/unit/` (`planner.core.test.ts`, `transit-zones.test.ts` and `route-legs.test.ts`). Run them with `cd backend; npm test -- tests/unit/`.

| **Interface** | **Describe Group Location, No Mocks** | **Describe Group Location, With Mocks** | **Mocked Components** |
| ------------- | ------------------------------------- | --------------------------------------- | --------------------- |
| **POST /api/auth/google** | [`backend/tests/no-mock/auth.google.test.ts#L10`](../backend/tests/no-mock/auth.google.test.ts#L10) | [`backend/tests/mock/auth.google.test.ts#L51`](../backend/tests/mock/auth.google.test.ts#L51) | Google ID token verification (`OAuth2Client.verifyIdToken`), User DB, Session DB |
| **POST /api/auth/sign-out** | [`backend/tests/no-mock/auth.sign-out.test.ts#L12`](../backend/tests/no-mock/auth.sign-out.test.ts#L12) | [`backend/tests/mock/auth.sign-out.test.ts#L19`](../backend/tests/mock/auth.sign-out.test.ts#L19) | Session DB |
| **GET /api/users/me** | [`backend/tests/no-mock/users.me.test.ts#L11`](../backend/tests/no-mock/users.me.test.ts#L11) | [`backend/tests/mock/users.me.test.ts#L20`](../backend/tests/mock/users.me.test.ts#L20) | Session DB, User DB |
| **GET /api/users/me/trips** | [`backend/tests/no-mock/users.trips.test.ts#L14`](../backend/tests/no-mock/users.trips.test.ts#L14) | [`backend/tests/mock/users.trips.test.ts#L19`](../backend/tests/mock/users.trips.test.ts#L19) | Trip DB |
| **POST /api/users/me/trips** | [`backend/tests/no-mock/users.trips-save.test.ts#L39`](../backend/tests/no-mock/users.trips-save.test.ts#L39) | [`backend/tests/mock/users.trips-save.test.ts#L20`](../backend/tests/mock/users.trips-save.test.ts#L20) | Trip DB |
| **PATCH /api/users/me/trips/:id** | [`backend/tests/no-mock/users.trips-update.test.ts#L22`](../backend/tests/no-mock/users.trips-update.test.ts#L22) | [`backend/tests/mock/users.trips-update.test.ts#L29`](../backend/tests/mock/users.trips-update.test.ts#L29) | Trip DB |
| **DELETE /api/users/me/trips/:id** | [`backend/tests/no-mock/users.trips-delete.test.ts#L15`](../backend/tests/no-mock/users.trips-delete.test.ts#L15) | [`backend/tests/mock/users.trips-delete.test.ts#L29`](../backend/tests/mock/users.trips-delete.test.ts#L29) | Trip DB |
| **PUT /api/users/me/profile** | [`backend/tests/no-mock/users.profile.test.ts#L31`](../backend/tests/no-mock/users.profile.test.ts#L31) | [`backend/tests/mock/users.profile.test.ts#L21`](../backend/tests/mock/users.profile.test.ts#L21) | User DB |
| **PUT /api/users/me/gas-price** | [`backend/tests/no-mock/users.gas-price.test.ts#L11`](../backend/tests/no-mock/users.gas-price.test.ts#L11) | [`backend/tests/mock/users.gas-price.test.ts#L19`](../backend/tests/mock/users.gas-price.test.ts#L19) | User DB |
| **DELETE /api/users/me** | [`backend/tests/no-mock/users.delete.test.ts#L17`](../backend/tests/no-mock/users.delete.test.ts#L17) | [`backend/tests/mock/users.delete.test.ts#L23`](../backend/tests/mock/users.delete.test.ts#L23) | User DB, Trip DB, Session DB, Google ID token verification (`OAuth2Client.verifyIdToken`, to sign in again after deleting) |
| **GET /api/users/me/parking-spots** | [`backend/tests/no-mock/users.parking-spots.test.ts#L16`](../backend/tests/no-mock/users.parking-spots.test.ts#L16) | [`backend/tests/mock/users.parking-spots.test.ts#L39`](../backend/tests/mock/users.parking-spots.test.ts#L39) | User DB |
| **POST /api/users/me/parking-spots** | [`backend/tests/no-mock/users.parking-spots.test.ts#L62`](../backend/tests/no-mock/users.parking-spots.test.ts#L62) | [`backend/tests/mock/users.parking-spots.test.ts#L74`](../backend/tests/mock/users.parking-spots.test.ts#L74) | User DB |
| **PUT /api/users/me/parking-spots/:id** | [`backend/tests/no-mock/users.parking-spots.test.ts#L275`](../backend/tests/no-mock/users.parking-spots.test.ts#L275) | [`backend/tests/mock/users.parking-spots.test.ts#L110`](../backend/tests/mock/users.parking-spots.test.ts#L110) | User DB |
| **DELETE /api/users/me/parking-spots/:id** | [`backend/tests/no-mock/users.parking-spots.test.ts#L364`](../backend/tests/no-mock/users.parking-spots.test.ts#L364) | [`backend/tests/mock/users.parking-spots.test.ts#L166`](../backend/tests/mock/users.parking-spots.test.ts#L166) | User DB |
| **GET /api/vehicles/makes** | [`backend/tests/no-mock/vehicles.test.ts#L14`](../backend/tests/no-mock/vehicles.test.ts#L14) | _None: nothing external can fail_ | _None_ |
| **GET /api/vehicles/makes/:make/models** | [`backend/tests/no-mock/vehicles.test.ts#L43`](../backend/tests/no-mock/vehicles.test.ts#L43) | _None: nothing external can fail_ | _None_ |
| **GET /health** | [`backend/tests/no-mock/health.test.ts#L6`](../backend/tests/no-mock/health.test.ts#L6) | _None: nothing external can fail_ | _None_ |
| **POST /api/routes/plan** | [`backend/tests/no-mock/routes.plan.test.ts#L28`](../backend/tests/no-mock/routes.plan.test.ts#L28) | [`backend/tests/mock/routes.plan.test.ts#L183`](../backend/tests/mock/routes.plan.test.ts#L183) | Google Routes API (`fetch`), User DB for saved parking spots |
| **PUT /api/users/me/planning-preferences** | [`backend/tests/no-mock/users.planning-preferences.test.ts#L12`](../backend/tests/no-mock/users.planning-preferences.test.ts#L12) | [`backend/tests/mock/users.planning-preferences.test.ts#L19`](../backend/tests/mock/users.planning-preferences.test.ts#L19) | User DB |

"No mocks" tests run against a real MongoDB (the same `mongo:7.0` image deployed on the VM). The sign-in tests that need Google to accept a token are in the mocked group, because automated tests can't get a real Google ID token. Every other test signs users in by adding a user and session straight to the test database (`backend/tests/helpers/auth.ts`), so it doesn't need Google.

The vehicle list endpoints have no mocked group. Their data is `backend/src/data/vehicles.json`, a file in the repo loaded once at startup, so beyond the session check (already covered by the mocked `GET /api/users/me` tests) there is nothing external that can fail.

#### 2.1.2. Commit Hash Where Tests Run

`4af7b0632009b09bca8502b04ef34cc77fee5e7a`

This is the last commit on `main` that changes code, with the Planner (#72), Planning and Trip Preview (#73), the trip lifecycle (#74), and the Codacy fixes and Planner tests (#82). Later commits only change documentation.

#### 2.1.3. Explanation on How to Run the Tests

1. **Install the prerequisites:** Node.js 22 and Docker (running).

2. **Clone the repository and install dependencies:**
   ```
   git clone https://github.com/adamdeleeuw/trailmix.git
   cd trailmix/backend
   npm ci
   ```

3. **Run the tests:** from the repository root, run one of these:
   ```
   ./scripts/run-backend-interface-tests.sh        # macOS / Linux
   .\scripts\run-backend-interface-tests.ps1       # Windows
   ```
   The script starts the docker compose `mongo` container (bound to `127.0.0.1:27017`), then runs the mocked tests, the unmocked tests, and both together. Each run writes its coverage report to `backend/coverage/mock`, `backend/coverage/no-mock`, and `backend/coverage/interface`. Open `index.html` in any of those folders to browse the report. Every page's title and heading starts with the run it belongs to ("Mocked tests", "No-mock tests" or "All tests (mock + no-mock)"), so the reports and their screenshots can't be mixed up.

   To use another MongoDB, set `MONGODB_TEST_URI` (e.g. `mongodb://localhost:27017`) and the script won't start the container. Each Jest worker uses its own `trailmix-test-<worker>` database and drops it when it finishes.

   One unmocked `POST /api/routes/plan` test checks the geometry of a real Google route, so it only runs with `RUN_LIVE_ROUTE_GEOMETRY_TESTS=true` and a real `GOOGLE_ROUTES_API_KEY`, and the runs report it as 1 skipped test otherwise. Every other test needs no API keys.

### 2.2. GitHub Actions Configuration Location

`~/.github/workflows/backend.yml` (the `test` job runs the same script, with a `mongo:7.0` service container)

Each run posts a coverage table for all three runs on its summary page and uploads the three HTML reports as the `backend-coverage` artifact. The combined report is also uploaded to Codacy.

![Passing Backend workflow run with the coverage summary](images/backend-ci-run.png)

### 2.3. Jest Coverage Report Screenshots With Mocks

![Jest coverage report for tests/mock/](images/backend-coverage-mock.png)

### 2.4. Jest Coverage Report Screenshots Without Mocks

![Jest coverage report for tests/no-mock/](images/backend-coverage-no-mock.png)

### 2.5. Jest Coverage Report Screenshots, Both Combined

![Jest coverage report for tests/mock/ and tests/no-mock/ together](images/backend-coverage-combined.png)

The combined run covers 96.87% of statements, 89.81% of branches, 96.27% of functions and 97.67% of lines. Every file below 100% is listed in 2.6, with the reason API tests can't reach its lines, or the Planner branches they don't exercise yet.

### 2.6. Lines API Tests Can't Reach

The combined run covers 100% of the statements, branches, functions, and lines in every file issues #7, #9, #10, #11, #71 and #74, and the trip history feature (PR #20) add or change, except for the lines below. Issue #71's files (`parking-spot.service.ts`, `parking-spots.controller.ts`, `parking-spot.validation.ts`, and its changes to `users.route.ts`) and issue #74's files (`trip.model.ts`, `trip.service.ts`, `trips.controller.ts`, `trip.validation.ts` and `common.validation.ts`) have no gaps. API tests build the app with `createApp()` and never start the server process.

| **File** | **Lines** | **Reason** |
| -------- | --------- | ---------- |
| `backend/src/index.ts` | 1–31 | The process entry point: it checks the environment, connects to MongoDB, calls `listen`, and handles SIGINT/SIGTERM. Tests import `createApp()` instead of starting the server, and the test helper connects to the database itself. |
| `backend/src/config/env.ts` | 20 | Rejecting an invalid `PORT`. This runs once when the module is first loaded, and tests can't change the environment before that. |
| `backend/src/config/env.ts` | 26 | Throwing when a required variable is missing. The test setup always provides `GOOGLE_BACKEND_CLIENT_ID` and `GOOGLE_ROUTES_API_KEY`, and `MONGODB_URI` is only read at startup. |
| `backend/src/config/env.ts` | 37, 50–51 | The `mongodbUri` getter and `assertEnv()`, which only `index.ts` calls. |
| `backend/src/middleware/error-handler.middleware.ts` | 18–19 | Handing the error to Express when the response has already started. Every route sends its response in a single call after all of its work succeeds, so no request can fail after headers have gone out. |
| `backend/src/services/planner.core.ts` | 221 | The schedule estimate used when a transit route has no departure or arrival time. Every route details request the Planner sends includes a time, so `computeRouteDetails` always returns both. |
| `backend/src/services/route-legs.ts` | 181 | The last `else` when a short walk is merged into a leg next to it. Back-to-back walks are grouped into one first, so a short walk always has a non-walking leg on at least one side. |

#### 2.6.1. Planner Branches Not Covered (issue #72)

The API tests run every line and function of the Planner's files except the two lines above. The branches below are the only parts the tests don't exercise:

| **File** | **Branches** | **What isn't exercised** |
| -------- | ------------ | ------------------------ |
| `backend/src/services/route-legs.ts` | 39 | Errors for a malformed encoded polyline, choosing a leg's start and end labels when its step has no useful label, and joining two polylines that don't meet at the same point. |
| `backend/src/services/planner.google.service.ts` | 33 | A matrix response that isn't a list or has malformed elements, invalid timestamps, and the fallbacks for optional fields Google always sends in the tests (line names, colours, stop details, distances and step times). |
| `backend/src/services/planner.service.ts` | 17 | Tie-breakers in the ranking comparators (two routes with the same cost, time or score), and checks that can't fail through the API, like an empty departure time or a chain without a spot. |
| `backend/src/services/planner.core.ts` | 9 | A chain through a spot with no cost or a daily rate, a chain that would leave in the past or walk too far, an origin equal to the destination, and the same comparator tie-breakers. |
| `backend/src/services/planner.constants.ts` | 1 | An adult monthly pass with no zones saved. The questionnaire rejects that fare type without zones, so the API can't reach it. |

---

## 3. Tests of Non-Functional Requirements

### 3.1. Test Locations in Git

| **Non-Functional Requirement** | **Location in Git** |
| ------------------------------ | ------------------- |
| **Planning Response Time** (95% of plans within 4 s) | [`backend/tests/nfr/planner.response-time.test.ts#L80`](../backend/tests/nfr/planner.response-time.test.ts#L80) |

Run it from the repository root with `./scripts/run-backend-nfr-tests.sh` (macOS / Linux) or `.\scripts\run-backend-nfr-tests.ps1` (Windows), with Docker running for the test MongoDB as in 2.1.3. The Security requirement doesn't have an automated test yet, so the second NFR test is planned for CP3.

### 3.2. Test Verification and Logs

- **Planning Response Time**

  - **Verification:** The test signs in a user with a car, a gas price, a transit fare and three saved parking spots between UBC and Waterfront Station, then sends 20 authenticated `POST /api/routes/plan` requests from UBC to Waterfront with Drive and Transit allowed. It replaces Google Routes with a stub that waits the latencies in [`backend/tests/fixtures/planner-google-latencies.json`](../backend/tests/fixtures/planner-google-latencies.json) (35 ms for the driving matrix, 50 ms for the transit matrix and 40 ms for each route's details) before answering, so the timing covers the whole request through Express, the session check, MongoDB, and the Planner's candidate selection, scheduling, pricing and ranking, without depending on Google's speed or charging the API key. It measures each request with `performance.now()`, checks that every response is `200` with three routes, and passes only if the 95th percentile is at most 4,000 ms. The fixture latencies are far below real Google calls, so this measures the time the Planner itself adds, not Google's.
  - **Log Output** (2026-11-04, Node 22.21.0, commit `4af7b06`)
    ```
    Planner response times ms: 241.9, 146.5, 151.1, 138.1, 163.3, 149.1, 154.8, 146.4, 145.3, 138.8, 140.5, 152.0, 141.8, 139.3, 166.9, 149.5, 137.5, 138.1, 138.2, 127.2
    Planner p95: 166.9 ms
    Test Suites: 1 passed, 1 total
    Tests:       1 passed, 1 total
    ```

---

## 4. Front-end Test Specification

### 4.1. Location in Git of Front-end Test Suite:

`frontend/app/src/androidTest/java/com/example/cpen321application/e2e/` (run on the Pixel 9 API 36 emulator against the deployed backend)

The end-to-end test is [`PlanTripTest.kt`](../frontend/app/src/androidTest/java/com/example/cpen321application/e2e/PlanTripTest.kt). It drives the app through Compose testing against the real backend, Google Places and Google Routes, with nothing mocked. The other files in `e2e/` (`BackButtonTest`, `NavBarTest` and `QuestionnaireBackTest`) are UI integration tests that use stand-in screens and a fake backend, so they don't count as end-to-end tests and will move out of `e2e/`.

**How to run it:**

1. Start the Pixel 9 API 36 emulator, and install and open the debug app (`./scripts/run-frontend.sh` or `.\scripts\run-frontend.ps1`).
2. Sign in with a Google account that has finished the questionnaire, has no saved parking spots and no active trip, and keeps the default modes (Drive and Transit).
3. From the repository root, run `./scripts/run-frontend-e2e-tests.sh` (macOS / Linux) or `.\scripts\run-frontend-e2e-tests.ps1` (Windows), and press Enter when it asks whether you're signed in.

The test grants location permission itself, saves its own parking spot through the app, and deletes that spot afterwards, so it leaves the account as it found it.

Unit tests for the app's logic, such as sign-in routing and sign-out, are in `frontend/app/src/test/java/com/example/cpen321application/`. The Map tab's search, parking spots, tapped places and location prompts are covered by `MapSearchViewModelTest`, `ParkingSpotsViewModelTest`, `LocationStateTest` and `ParkingSpotFormatTest` there. Planning and Trip Preview are covered by `PlanningViewModelTest`, `PlanningFormatTest`, `PreviewFormatTest` and `PreviewGeometryTest`. The trip lifecycle (issue #74) is covered by `TripHistoryViewModelTest` (save, start, the "End your current trip?" flow, end and delete), `TripTotalsTest` and `TripHistoryListTest` (History's totals and list), and `NavigationFormatTest` (the current leg, arriving, ending early and the Navigation text).

### 4.2. Tests

- **Use Case: Plan Multimodal Trip** ([Requirements_and_Design.md, Use Case 1](Requirements_and_Design.md#uc1))

  - **Expected Behaviors:**

    | **Scenario Steps** | **Test Case Steps** |
    | ------------------ | ------------------- |
    | 1. The user searches for a destination on the Map tab and taps **Directions** on its place sheet. | Both tests: type "Waterfront Station" into the search box, tap the first suggestion that contains it, wait for **Directions** on its sheet and tap it. |
    | 2. The app opens Planning with the user's location as the start, the default modes and longest walk, and **Leave now**. | Location permission is granted before the app opens, so the start is "Your location" (or "Choose start point" if the emulator has no location fix yet). The modes and longest walk keep the account's defaults. |
    | 3. The user changes the start, the modes, the longest walk, or sets **Arrive by**. | Tap the start field and search for "University of British Columbia". In `plansUpToThreeRoutesAndPreviewsOne`, also tap **Leave now ▾**, **Tomorrow** and **Set**, and check the chip says "Arrive by … tomorrow". |
    | 4. The app sends the trip to the Planner. | Wait up to 30 s until the loading indicator is gone and either routes or "Couldn't reach the route service." show. |
    | 5. The Planner considers driving, transit, and Drive → Transit through nearby saved spots, then schedules, prices and ranks them. | `plansUpToThreeRoutesAndPreviewsOne` first saves "Metropolis at Metrotown" as a parking spot through its place sheet, so the Planner has a spot to switch at, and checks the no-spots banner doesn't show. |
    | 6. The app shows up to three routes labelled Cheapest, Fastest and Balanced. | Check there are 1 to 3 route rows labelled Cheapest, Fastest or Balanced, and that "Couldn't reach the route service." isn't shown. |
    | 2a. Location is off or unknown. | Not automated yet: the system's permission prompt is outside the app, so the test grants location before starting. |
    | 5a. Drive is on, but the user has no saved parking spots. The app shows the banner with **Back to map**. | `driveWithNoParkingSpotsShowsTheBanner`: check the account has no saved spots, plan UBC to Waterfront Station, check "Save a parking spot to plan driving trips" shows, tap **Back to map**, and check **Directions** (the destination's place sheet) shows again. |
    | 5b. Drive is on, but the gas price or car isn't set. | Not automated yet: it depends on the signed-in account's profile, which the test doesn't change. |
    | 5c. No route exists for any allowed mode. | Not automated yet: Google finds a route between any two places the search offers in Metro Vancouver. |
    | 5d. Google Routes can't be reached, even after one retry. | Not automated yet: causing it needs a mocked backend, and these tests use the real one. Any run where it happens fails in the wait in step 4. The mocked backend tests of `POST /api/routes/plan` check the `503` itself. |

  - **Test Logs:** The run of `scripts/run-frontend-e2e-tests.sh` on 2026-11-04, on the Pixel 9 emulator (API 36). The Docker and Gradle build output is trimmed. Gradle's console only prints totals, so each test's result below comes from the run's JUnit report in `frontend/app/build/outputs/androidTest-results/connected/debug/`.
    ```
    $ bash scripts/run-frontend-e2e-tests.sh
    ==> Starting backend (scripts/run-backend.sh) ...
     ✔ Image cpen321-project-backend       Built
     ✔ Container cpen321-project-mongo-1   Healthy
     ✔ Container cpen321-project-backend-1 Running
    ==> Backend is up. Stop with: docker compose down
    ==> Emulator already running.
    ==> Building and installing app...
    Installed on 1 device.
    BUILD SUCCESSFUL in 25s
    ==> Launching app...
    ==> Done. Sign in on the emulator to verify.
    ==> Running frontend E2E tests (com.example.cpen321application.e2e.BackButtonTest,com.example.cpen321application.e2e.NavBarTest,com.example.cpen321application.e2e.PlanTripTest,com.example.cpen321application.e2e.QuestionnaireBackTest) ...

    > Task :app:connectedDebugAndroidTest
    Starting 12 tests on Pixel_9(AVD) - 16
    Pixel_9(AVD) - 16 Tests 12/12 completed. (0 skipped) (0 failed)
    Finished 12 tests on Pixel_9(AVD) - 16

    BUILD SUCCESSFUL in 2m 16s
    ==> Frontend E2E tests finished.

    Results (JUnit report, 12 tests, 0 failures, 0 errors, 0 skipped):
    PASSED  PlanTripTest.driveWithNoParkingSpotsShowsTheBanner          21.36 s
    PASSED  PlanTripTest.plansUpToThreeRoutesAndPreviewsOne             25.58 s
    PASSED  BackButtonTest.backOnSignInExitsApp                          3.87 s
    PASSED  BackButtonTest.backOnMainExitsApp                            3.20 s
    PASSED  NavBarTest.barIsHiddenOnTheEditScreenAndBackReturnsToProfile 5.10 s
    PASSED  NavBarTest.tabKeepsItsPlaceWhenSwitchingAwayAndBack          5.54 s
    PASSED  NavBarTest.backFromHistoryOrProfileGoesToMap                 8.58 s
    PASSED  NavBarTest.opensOnMapWithMapSelected                         3.01 s
    PASSED  NavBarTest.historyTabShowsTheHistoryScreen                   3.48 s
    PASSED  QuestionnaireBackTest.keepGoingClosesTheDialog               3.27 s
    PASSED  QuestionnaireBackTest.signOutSignsOut                        3.14 s
    PASSED  QuestionnaireBackTest.backAgainClosesTheDialog               3.05 s
    ```

- **Use Case: Preview Route** ([Requirements_and_Design.md, Use Case 2](Requirements_and_Design.md#uc2))

  - **Expected Behaviors:**

    | **Scenario Steps** | **Test Case Steps** |
    | ------------------ | ------------------- |
    | 1. In Planning, the user taps a route. | `plansUpToThreeRoutesAndPreviewsOne`: after planning (Use Case 1, steps 1–6), tap the first route row. |
    | 2. The app opens Trip Preview with the legs, the timeline from **Leave** to **Arrive at**, the costs, **Start** and **Save for later**. | Check **Start**, **Save for later** and a "Leave …" row show, then scroll the timeline to its last row and check "Arrive at …" shows. |
    | 3. The user taps a timeline row, and the map pans to that point. | Not automated yet: the map's camera isn't visible to Compose's test APIs. |
    | 4. The user taps Back, and the app returns to Planning with the same routes and arrive-by time, without planning again. | Tap **Back**, check the same number of route rows show, the chip still says "Arrive by … tomorrow", and no loading indicator shows (so no new plan was made). |
    | 2a. A transit line has no colour from Google. | Not automated yet: Google's colours can't be controlled without mocking. |
    | 2b. A parking spot's cost isn't known. | Not automated yet: the test's spot is saved without a cost, but whether the picked route uses it depends on Google's times. |

  - **Test Logs:** the same run as Plan Multimodal Trip above, since `plansUpToThreeRoutesAndPreviewsOne` covers both use cases.
