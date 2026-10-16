# Testing

## 1. Change History

| **Change Date**   | **Modified Sections** | **Rationale** |
| ----------------- | --------------------- | ------------- |
| 2026-10-15        | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | Added the sign-in, sign-out and "get my account" API tests (issue #9) |

---

## 2. Back-end Test Specification: APIs

### 2.1. Locations of Back-end Tests and Instructions to Run Them

#### 2.1.1. Tests

| **Interface** | **Describe Group Location, No Mocks** | **Describe Group Location, With Mocks** | **Mocked Components** |
| ------------- | ------------------------------------- | --------------------------------------- | --------------------- |
| **POST /api/auth/google** | [`backend/tests/no-mock/auth.google.test.ts#L10`](../backend/tests/no-mock/auth.google.test.ts#L10) | [`backend/tests/mock/auth.google.test.ts#L51`](../backend/tests/mock/auth.google.test.ts#L51) | Google ID token verification (`OAuth2Client.verifyIdToken`), User DB, Session DB |
| **POST /api/auth/sign-out** | [`backend/tests/no-mock/auth.sign-out.test.ts#L12`](../backend/tests/no-mock/auth.sign-out.test.ts#L12) | [`backend/tests/mock/auth.sign-out.test.ts#L19`](../backend/tests/mock/auth.sign-out.test.ts#L19) | Session DB |
| **GET /api/users/me** | [`backend/tests/no-mock/users.me.test.ts#L11`](../backend/tests/no-mock/users.me.test.ts#L11) | [`backend/tests/mock/users.me.test.ts#L20`](../backend/tests/mock/users.me.test.ts#L20) | Session DB, User DB |
| **GET /health** | [`backend/tests/no-mock/health.test.ts#L6`](../backend/tests/no-mock/health.test.ts#L6) | _None: nothing external can fail_ | _None_ |

"No mocks" tests run against a real MongoDB (the same `mongo:7.0` image deployed on the VM). The sign-in tests that need Google to accept a token are in the mocked group, because automated tests can't get a real Google ID token. Every other test signs users in by adding a user and session straight to the test database (`backend/tests/helpers/auth.ts`), so it doesn't need Google.

#### 2.1.2. Commit Hash Where Tests Run

`[Insert Commit SHA here]`

#### 2.1.3. Explanation on How to Run the Tests

1. **Install the prerequisites:** Node.js 22 and Docker (running).

2. **Clone the repository and install dependencies:**
   ```
   git clone https://github.com/adamdeleeuw/trailmix.git
   cd trailmix/backend
   npm install
   ```

3. **Run the tests:** from the repository root, run one of these:
   ```
   ./scripts/run-backend-interface-tests.sh        # macOS / Linux
   .\scripts\run-backend-interface-tests.ps1       # Windows
   ```
   The script starts the docker compose `mongo` container (bound to `127.0.0.1:27017`), then runs the mocked tests, the unmocked tests, and both together. Each run writes its coverage report to `backend/coverage/mock`, `backend/coverage/no-mock`, and `backend/coverage/interface`. Open `lcov-report/index.html` in any of those folders to browse the report.

   To use another MongoDB, set `MONGODB_TEST_URI` (e.g. `mongodb://localhost:27017`) and the script won't start the container. Each Jest worker uses its own `trailmix-test-<worker>` database and drops it when it finishes.

### 2.2. GitHub Actions Configuration Location

`~/.github/workflows/backend.yml` (the `test` job runs the same script, with a `mongo:7.0` service container)

Each run posts a coverage table for all three runs on its summary page and uploads the three HTML reports as the `backend-coverage` artifact. The combined report is also uploaded to Codacy.

_(Placeholder for a screenshot of the passing GitHub Actions run)_

### 2.3. Jest Coverage Report Screenshots With Mocks

_(Placeholder for Jest coverage screenshot with mocks enabled)_

### 2.4. Jest Coverage Report Screenshots Without Mocks

_(Placeholder for Jest coverage screenshot without mocks)_

### 2.5. Jest Coverage Report Screenshots, Both Combined

Add later

### 2.6. Lines API Tests Can't Reach

The combined run covers 100% of the statements, branches, functions, and lines in every file issue #9 adds or changes, except for the lines below. API tests build the app with `createApp()` and never start the server process.

| **File** | **Lines** | **Reason** |
| -------- | --------- | ---------- |
| `backend/src/index.ts` | 1–27 | The process entry point: it checks the environment, connects to MongoDB, calls `listen`, and handles SIGINT/SIGTERM. Tests import `createApp()` instead of starting the server, and the test helper connects to the database itself. |
| `backend/src/config/env.ts` | 15, 19–20 | Parsing and rejecting `PORT`. This runs once when the module is first loaded, and tests can't change the environment before that. |
| `backend/src/config/env.ts` | 25–26 | Throwing when a required variable is missing. The test setup always provides `GOOGLE_BACKEND_CLIENT_ID`, and `MONGODB_URI` is only read at startup. |
| `backend/src/config/env.ts` | 39, 49–50 | The `mongodbUri` getter and `assertEnv()`, which only `index.ts` calls. |
| `backend/src/middleware/error-handler.middleware.ts` | 17–19 | Handing the error to Express when the response has already started. Every route sends its response in a single call after all of its work succeeds, so no request can fail after headers have gone out. |

---

## 3. Tests of Non-Functional Requirements

### 3.1. Test Locations in Git

| **Non-Functional Requirement**  | **Location in Git**                              |
| ------------------------------- | ------------------------------------------------ |
| **Performance (Response Time)** | [`backend/tests/nfr/response_time.test.js`](#) |
| **Chat Data Security**          | [`backend/tests/nfr/chat_security.test.js`](#) |

### 3.2. Test Verification and Logs

- **Performance (Response Time)**

  - **Verification:** This test suite simulates multiple concurrent API calls using Jest along with a load-testing utility to mimic real-world user behavior. The focus is on key endpoints such as user login and study group search to ensure that each call completes within the target response time of 2 seconds under normal load. The test logs capture metrics such as average response time, maximum response time, and error rates. These logs are then analyzed to identify any performance bottlenecks, ensuring the system can handle expected traffic without degradation in user experience.
  - **Log Output**
    ```
    [Placeholder for response time test logs]
    ```

- **Chat Data Security**
  - **Verification:** ...
  - **Log Output**
    ```
    [Placeholder for chat security test logs]
    ```

---

## 4. Front-end Test Specification

### 4.1. Location in Git of Front-end Test Suite:

`frontend/app/src/androidTest/java/com/example/cpen321application/e2e/` (end-to-end UI tests, run on the emulator)

Unit tests for the app's logic, such as sign-in routing and sign-out, are in `frontend/app/src/test/java/com/example/cpen321application/`.

### 4.2. Tests

- **Use Case: Login**

  - **Expected Behaviors:**
    | **Scenario Steps** | **Test Case Steps** |
    | ------------------ | ------------------- |
    | 1. The user opens "Add Todo Items" screen. | Open "Add Todo Items" screen. |
    | 2. The app shows an input text field and an "Add" button. The add button is disabled. | Check that the text field is present on screen.<br>Check that the button labelled "Add" is present on screen.<br>Check that the "Add" button is disabled. |
    | 3a. The user inputs an ill-formatted string. | Input "_^_^^OQ#$" in the text field. |
    | 3a1. The app displays an error message prompting the user for the expected format. | Check that a dialog is opened with the text: "Please use only alphanumeric characters ". |
    | 3. The user inputs a new item for the list and the add button becomes enabled. | Input "buy milk" in the text field.<br>Check that the button labelled "add" is enabled. |
    | 4. The user presses the "Add" button. | Click the button labelled "add ". |
    | 5. The screen refreshes and the new item is at the bottom of the todo list. | Check that a text box with the text "buy milk" is present on screen.<br>Input "buy chocolate" in the text field.<br>Click the button labelled "add".<br>Check that two text boxes are present on the screen with "buy milk" on top and "buy chocolate" at the bottom. |
    | 5a. The list exceeds the maximum todo-list size. | Repeat steps 3 to 5 ten times.<br>Check that a dialog is opened with the text: "You have too many items, try completing one first". |

  - **Test Logs:**
    ```
    [Placeholder for Espresso test execution logs]
    ```

- **Use Case: ...**

  - **Expected Behaviors:**

    | **Scenario Steps** | **Test Case Steps** |
    | ------------------ | ------------------- |
    | ...                | ...                 |

  - **Test Logs:**
    ```
    [Placeholder for Espresso test execution logs]
    ```

- **...**
