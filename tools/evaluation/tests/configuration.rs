#[path = "support/configuration.rs"]
mod fixture;
#[path = "support/legacy.rs"]
mod legacy;
#[path = "support/service_sentinels.rs"]
mod service_sentinels;
#[path = "support/shared_legacy.rs"]
mod shared_legacy;
mod support;

#[path = "cases/configuration_adoption.rs"]
mod configuration_adoption;
#[path = "cases/configuration_adoption_rollback.rs"]
mod configuration_adoption_rollback;
#[path = "cases/configuration_adoption_safety.rs"]
mod configuration_adoption_safety;
#[path = "cases/configuration_inventory.rs"]
mod configuration_inventory;
#[path = "cases/configuration_inventory_safety.rs"]
mod configuration_inventory_safety;
#[path = "cases/configuration_links.rs"]
mod configuration_links;
#[path = "cases/configuration_package.rs"]
mod configuration_package;
#[path = "cases/configuration_package_resources.rs"]
mod configuration_package_resources;
#[path = "cases/configuration_package_settings.rs"]
mod configuration_package_settings;
#[path = "cases/configuration_package_themes.rs"]
mod configuration_package_themes;
#[path = "cases/configuration_safety.rs"]
mod configuration_safety;
#[path = "cases/configuration_settings.rs"]
mod configuration_settings;
#[path = "cases/configuration_settings_numbers.rs"]
mod configuration_settings_numbers;
#[path = "cases/configuration_settings_rollback.rs"]
mod configuration_settings_rollback;
#[path = "cases/configuration_settings_safety.rs"]
mod configuration_settings_safety;
#[path = "cases/package_config_cli.rs"]
mod package_config_cli;
#[path = "cases/package_install.rs"]
mod package_install;
#[path = "cases/package_manifest.rs"]
mod package_manifest;
