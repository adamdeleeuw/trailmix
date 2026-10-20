# Requirements and Design

## 1. Change History

| **Change Date**   | **Modified Sections** | **Rationale** |
| ----------------- | --------------------- | ------------- |
| 2026-10-19        | 4.2, 4.4 | Added the user's last gas price to the `users` collection, described what deleting an account removes, and listed Navigation Compose, which the app's nav bar uses (issue #11) |
| 2026-10-19        | 4.2 | Deleting an account now also deletes the user's saved trips, which the trip history feature (PR #20) added, as the delete confirmation promises |

---

## 2. Project Description

[WRITE_PROJECT_DESCRIPTION_HERE]

---

## 3. Requirements Specification

### **3.1. List of Features**


### **3.2. Use Case Diagram**


### **3.3. Actors Description**
1. **[WRITE_NAME_HERE]**: ...
2. **[WRITE_NAME_HERE]**: ...

### **3.4. Use Case Description**
- Use cases for feature 1: [WRITE_FEATURE_1_NAME_HERE]
1. **[WRITE_NAME_HERE]**: ...
2. **[WRITE_NAME_HERE]**: ...
- Use cases for feature 2: [WRITE_FEATURE_2_NAME_HERE]
3. **[WRITE_NAME_HERE]**: ...
4. **[WRITE_NAME_HERE]**: ...
...

### **3.5. Formal Use Case Specifications (5 Most Major Use Cases)**
<a name="uc1"></a>

#### Use Case 1: [WRITE_USE_CASE_1_NAME_HERE]

**Description**: ...

**Primary actor(s)**: ... 
    
**Main success scenario**:
1. ...
2. ...

**Failure scenario(s)**:
- 1a. ...
    - 1a1. ...
    - 1a2. ...

- 1b. ...
    - 1b1. ...
    - 1b2. ...
                
- 2a. ...
    - 2a1. ...
    - 2a2. ...

...

<a name="uc2"></a>

#### Use Case 2: [WRITE_USE_CASE_2_NAME_HERE]
...

### **3.6. Screen Mock-ups**


### **3.7. Non-Functional Requirements**
<a name="nfr1"></a>

1. **[WRITE_NAME_HERE]**
    - **Description**: ...
    - **Justification**: ...
2. ...

---

## 4. Designs Specification
### **4.1. Main Components**
1. **[WRITE_NAME_HERE]**
    - **Purpose**: ...
    - **Interfaces**: 
        1. ...
            - **Purpose**: ...
        2. ...
2. ...


### **4.2. Databases**
1. **MongoDB (`mongo:7.0`)**
    - **Purpose**: Stores Trailmix's accounts and sign-in sessions. It runs as a container next to the backend on the VM and is reachable only over the private docker compose network. Its data lives in the `mongo-data` volume, so it survives restarts, rebuilds, and deploys.
    - **`users` collection**: one document per account, with `googleId` (Google's account ID), `email`, `name`, `photoUrl`, `profileComplete`, `timezone`, `vehicle`, `transit`, `lastGasPrice`, `createdAt`, and `updatedAt`.
        - A **unique index on `googleId`** identifies users by the Google ID, which never changes, rather than by email, which can. The index also makes the database refuse a second account for the same Google account, even when two first sign-ins arrive at once.
        - The email, name, and photo are refreshed from Google on every sign-in.
        - The commute questionnaire adds `timezone`, `vehicle` (`make`, `model`, `colour`, `litresPer100km`, or `null` if the user doesn't drive), and `transit` (`fareType`, `monthlyPassZones`, or `null` if the user doesn't take transit). They sit inside the user document because there's only one of each and they're always loaded with the user. Only the fare type is stored, not the price, since fares change every year. Submitting the questionnaire replaces all three and sets `profileComplete`.
        - `lastGasPrice` (`centsPerLitre` and `savedAt`, or `null` until the user saves one) is the last gas price a driver entered on the Profile tab. The price must be 50.0–400.0 ¢/L with at most one decimal. The server sets `savedAt`, so the date can't be faked by the phone's clock. Only the latest price is kept, since only the latest is used to estimate driving costs.
        - Deleting an account (`DELETE /api/users/me`) removes the user document first, then every trip and every session for that `userId`, so the trip history is gone and every device the user was signed in on is signed out. Signing in again with the same Google account creates a new, empty account.
        - The car makes and models the questionnaire offers come from `backend/src/data/vehicles.json`, a hand-picked list in the repo loaded once at startup, not from the database.
    - **`sessions` collection**: one document per signed-in device, with `tokenHash`, `userId`, and `createdAt`.
        - The app holds a random 256-bit token. Only its SHA-256 hash is stored (with a **unique index**), so a leaked database can't be used to sign in, and finding a session is one indexed lookup.
        - Sessions are kept separate from users so one user can be signed in on several devices, and signing out deletes only that device's session.
        - Sessions never expire on their own. A session ends when its device signs out, or when the account is deleted (`userId` is **indexed** so every session for the account can be removed at once). A session whose account no longer exists is rejected.


### **4.3. External Modules**
1. **[WRITE_NAME_HERE]** 
- **Purpose**: ...
2. ...


### **4.4. Frameworks and Libraries**
1. **Navigation Compose (`androidx.navigation:navigation-compose`)**
    - **Purpose**: Moves between the screens after sign-in: the Map, History, and Profile tabs of the nav bar, and the Edit vehicle and Edit transit screens opened from Profile. It keeps each tab's back stack and scroll position when the user switches tabs, and makes Back on any tab return to Map.
    - **Reason**: It is the official Jetpack library for navigating between Compose screens. Writing our own back stack would mean re-implementing saving and restoring each tab's state across tab switches and screen rotation.
2. ...


### **4.5. Dependencies Diagram**


### **4.6. Use Case Sequence Diagram (5 Most Major Use Cases)**
1. [**[WRITE_NAME_HERE]**](#uc1)\
[SEQUENCE_DIAGRAM_HERE]
2. ...


### **4.7. Design of Non-Functional Requirements**
1. [**[WRITE_NAME_HERE]**](#nfr1)
    - **Implementation**: ...
2. ...
