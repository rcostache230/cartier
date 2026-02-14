"""Parking management module for neighbourhood slot sharing."""

from .service import (
    ABOVE_GROUND_CAPACITY_PER_BUILDING,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_USERNAME,
    DEFAULT_RESIDENT_PASSWORD,
    AuthenticationError,
    AuthorizationError,
    PARKING_TYPES,
    ParkingModuleError,
    ParkingService,
    ParkingSlot,
    SlotNotFoundError,
    SlotValidationError,
    UNDERGROUND_CAPACITY_PER_BUILDING,
    UserAccount,
    UserNotFoundError,
)

__all__ = [
    "ABOVE_GROUND_CAPACITY_PER_BUILDING",
    "DEFAULT_ADMIN_PASSWORD",
    "DEFAULT_ADMIN_USERNAME",
    "DEFAULT_RESIDENT_PASSWORD",
    "AuthenticationError",
    "AuthorizationError",
    "PARKING_TYPES",
    "ParkingModuleError",
    "ParkingService",
    "ParkingSlot",
    "SlotNotFoundError",
    "SlotValidationError",
    "UNDERGROUND_CAPACITY_PER_BUILDING",
    "UserAccount",
    "UserNotFoundError",
]
