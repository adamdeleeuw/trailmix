# Trailmix Dependency Diagram

The diagram groups components by the feature they support. Shared infrastructure and external providers are shown separately. Arrows indicate a dependency or request direction.

```mermaid
flowchart LR
    subgraph Android[Android app]
        AuthUI[Sign-in UI and Google sign-in client]
        ProfileUI[Profile and questionnaire UI]
        TripsUI[Trip history UI]
        ParkingUI[Saved parking spots UI]
        PlannerUI[Map and route planning UI]
        Client[Backend API client and session store]
    end

    subgraph Backend[Trailmix backend]
        subgraph AuthFeature[Authentication and sessions]
            AuthEndpoint[Auth route and controller]
            AuthServices[Google verification and session services]
        end
        subgraph ProfileFeature[Profile and planning preferences]
            ProfileEndpoint[User profile and preference endpoints]
            ProfileService[User service and profile validation]
        end
        subgraph TripsFeature[Saved trips]
            TripsEndpoint[Trip endpoints]
            TripsService[Trip service]
        end
        subgraph ParkingFeature[Saved parking spots]
            ParkingEndpoint[Parking spot endpoints]
            ParkingService[Parking spot service]
        end
        subgraph PlannerFeature[Route planning]
            PlanEndpoint[Plan route endpoint]
            Planner[Planner service and candidate scoring]
        end
        subgraph VehiclesFeature[Vehicle catalog]
            VehiclesEndpoint[Vehicle lookup endpoints]
            VehiclesService[Vehicle service and catalog]
        end
        Http[Express app, routing, session middleware and error handling]
        Models[Mongoose user, session and trip models]
        Startup[Startup and configuration]
    end

    subgraph Platform[Shared infrastructure]
        Proxy[Caddy HTTPS reverse proxy]
        Database[(MongoDB)]
    end

    subgraph Google[Google APIs and SDKs]
        Identity[Google Identity Services]
        Maps[Google Maps SDK for Android]
        Places["Google Places API (New)"]
        Routes[Google Routes API]
    end

    AuthUI --> Client
    ProfileUI --> Client
    TripsUI --> Client
    ParkingUI --> Client
    PlannerUI --> Client
    AuthUI --> Identity
    PlannerUI --> Maps
    PlannerUI --> Places
    Client -->|feature API requests| Proxy
    Client -->|local development| Http
    Proxy --> Http

    Startup --> Http
    Startup --> Models
    Http --> AuthEndpoint
    Http --> ProfileEndpoint
    Http --> TripsEndpoint
    Http --> ParkingEndpoint
    Http --> PlanEndpoint
    Http --> VehiclesEndpoint
    AuthEndpoint --> AuthServices
    ProfileEndpoint --> ProfileService
    TripsEndpoint --> TripsService
    ParkingEndpoint --> ParkingService
    PlanEndpoint -->|authenticated user and plan request| Planner
    Planner --> ParkingService
    VehiclesEndpoint --> VehiclesService
    Http -->|session middleware lookup| AuthServices
    AuthServices --> Models
    ProfileService --> Models
    TripsService --> Models
    ParkingService --> Models
    Models --> Database
    AuthServices -->|ID token verification| Identity
    Planner -->|route matrix and route details| Routes
```
