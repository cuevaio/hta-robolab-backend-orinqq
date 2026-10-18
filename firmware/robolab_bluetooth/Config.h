#pragma once
#include <Arduino.h>
constexpr char ROBOT_NOMBRE[] = "RoboLab";
constexpr uint8_t MOTOR_IZQUIERDO = 22;
constexpr uint8_t MOTOR_DERECHO = 23;
int velocidadAvance = 75;
int velocidadGiro = 110;
constexpr uint32_t FRECUENCIA_PWM = 500;
constexpr uint8_t BITS_PWM = 8;
constexpr uint8_t CANAL_MOTOR_IZQUIERDO = 0;
constexpr uint8_t CANAL_MOTOR_DERECHO = 2;
constexpr bool ACEPTAR_GIROS_EN_ARCO = true;
constexpr uint32_t MS_CASILLA = 1000;
constexpr uint32_t MS_GIRO_IZQUIERDA = 1000;
constexpr uint32_t MS_GIRO_DERECHA = 1000;
constexpr uint32_t MS_PAUSA = 100;
constexpr uint32_t MAX_EJECUCION_MS = 100000;
#define USAR_SH1106 1
constexpr uint8_t PIN_SDA = 21;
constexpr uint8_t PIN_SCL = 19;
constexpr uint8_t PIN_LED = 27;
constexpr uint8_t PIN_BUZZER = 16;
constexpr bool BUZZER_PASIVO = true;
constexpr bool BUZZER_ACTIVO_EN_ALTO = true;
constexpr uint8_t CANAL_LED = 4;
constexpr uint8_t CANAL_BUZZER = 6;

