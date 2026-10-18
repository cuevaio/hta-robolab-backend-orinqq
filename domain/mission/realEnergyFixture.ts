import type { Mission, Program } from "./contracts";

/** Propuesta real A1 (2026-10-18); JSON original intacto, sin credenciales. */
export const realEnergyMission: Mission = {
  "schemaVersion": 1,
  "id": "mission-3-energyeq",
  "revision": 1,
  "title": "Comparar rutas de energía",
  "objective": "Comparar el consumo de energía de distintas rutas y seleccionar una ruta que respete un presupuesto.",
  "grade": 3,
  "grid": {
    "rows": 4,
    "cols": 5,
    "cells": [
      {
        "position": {
          "row": 0,
          "col": 0
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 0,
          "col": 1
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 0,
          "col": 2
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 0,
          "col": 3
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 0,
          "col": 4
        },
        "terrain": "rough",
        "obstacle": false,
        "cost": 3
      },
      {
        "position": {
          "row": 1,
          "col": 0
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 1,
          "col": 1
        },
        "terrain": "rough",
        "obstacle": false,
        "cost": 3
      },
      {
        "position": {
          "row": 1,
          "col": 2
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 1,
          "col": 3
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 1,
          "col": 4
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 2,
          "col": 0
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 2,
          "col": 1
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 2,
          "col": 2
        },
        "terrain": "rough",
        "obstacle": false,
        "cost": 3
      },
      {
        "position": {
          "row": 2,
          "col": 3
        },
        "terrain": "rough",
        "obstacle": false,
        "cost": 3
      },
      {
        "position": {
          "row": 2,
          "col": 4
        },
        "terrain": "plain",
        "obstacle": true,
        "cost": 1
      },
      {
        "position": {
          "row": 3,
          "col": 0
        },
        "terrain": "rough",
        "obstacle": false,
        "cost": 3
      },
      {
        "position": {
          "row": 3,
          "col": 1
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 3,
          "col": 2
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 3,
          "col": 3
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      },
      {
        "position": {
          "row": 3,
          "col": 4
        },
        "terrain": "plain",
        "obstacle": false,
        "cost": 1
      }
    ]
  },
  "start": {
    "row": 0,
    "col": 0
  },
  "goal": {
    "row": 3,
    "col": 4
  },
  "initialHeading": 0,
  "checkpoints": [
    {
      "id": "c1",
      "position": {
        "row": 1,
        "col": 2
      }
    },
    {
      "id": "c2",
      "position": {
        "row": 2,
        "col": 1
      }
    }
  ],
  "energyBudget": 18,
  "allowedCommands": [
    "FORWARD",
    "BACKWARD",
    "TURN_LEFT",
    "TURN_RIGHT"
  ]
};

/** Testigo independiente: 11 movimientos, costo 19, ambas estaciones. */
export const realEnergyAlternative: Program = {
  "schemaVersion": 1,
  "commands": [
    "BACKWARD",
    "BACKWARD",
    "BACKWARD",
    "TURN_RIGHT",
    "FORWARD",
    "TURN_LEFT",
    "FORWARD",
    "FORWARD",
    "TURN_RIGHT",
    "FORWARD",
    "TURN_RIGHT",
    "FORWARD",
    "TURN_LEFT",
    "FORWARD",
    "TURN_RIGHT",
    "FORWARD",
    "TURN_LEFT",
    "FORWARD"
  ]
};
