from app.services.solar_validation import solar_offering

def test_incidental_mentions_are_not_a_solar_offering():
    assert solar_offering('Our accounting firm published a report about solar stocks.') is None
    assert solar_offering('A news story about solar panels appeared in our newsletter.') is None

def test_installer_and_supplier_service_offerings_are_supported():
    assert solar_offering('We install solar panels and battery systems in Leicester.')
    assert solar_offering('Solar panel cleaning and maintenance for commercial properties.')
    assert solar_offering('Shop solar equipment from our local warehouse.')

def test_negative_installation_claim_is_not_counted():
    assert solar_offering('We do not install solar panels. We only provide accounting services.') is None


def test_government_and_solar_marketing_services_are_not_solar_companies():
    from app.services.solar_validation import non_solar_business_reason
    assert non_solar_business_reason('https://www.energy.gov/solar','Solar manufacturing and research.')
    assert non_solar_business_reason('https://agency.example','AI for solar lead generation: qualified installation requests.')
    assert non_solar_business_reason('https://software.example','Software for solar installers and designers.')
    assert non_solar_business_reason('https://installer.example','We install solar panels and battery systems.') is None
