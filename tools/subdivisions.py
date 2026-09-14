"""Administrative subdivision counts used only to choose navigation depth.

Generated from Unicode CLDR 48 subdivision containment, whose top-level
territory groups are based on ISO 3166-2. A count includes the first-level
units represented by CLDR for that territory, regardless of whether the
Wayfinder catalogue currently has an adventure in each unit. CLDR sometimes
puts non-administrative regions above the functional administrative units.
The separately sourced overrides below correct those cases; a direct CLDR
count must not be described as universally authoritative.

Source: https://github.com/unicode-org/cldr/blob/release-48/common/supplemental/subdivisions.xml
Source SHA-256: 63095a3b5bd4e0a00d9e1cf96853808cacd0ec7c826dbcbfd31755c6cb9b6c55
Retrieved: 2026-09-14
"""

FIRST_LEVEL_SUBDIVISION_COUNTS = {
    'AD': 7,
    'AE': 7,
    'AF': 34,
    'AG': 8,
    'AL': 12,
    'AM': 11,
    'AO': 18,
    'AR': 24,
    'AT': 9,
    'AU': 8,
    'AZ': 70,
    'BA': 3,
    'BB': 11,
    'BD': 8,
    'BE': 3,
    'BF': 13,
    'BG': 28,
    'BH': 4,
    'BI': 18,
    'BJ': 12,
    'BN': 4,
    'BO': 9,
    'BQ': 3,
    'BR': 27,
    'BS': 32,
    'BT': 20,
    'BW': 16,
    'BY': 7,
    'BZ': 6,
    'CA': 13,
    'CD': 26,
    'CF': 17,
    'CG': 12,
    'CH': 26,
    'CI': 14,
    'CL': 16,
    'CM': 10,
    'CN': 34,
    'CO': 33,
    'CR': 7,
    'CU': 16,
    'CV': 2,
    'CY': 6,
    'CZ': 14,
    'DE': 16,
    'DJ': 6,
    'DK': 5,
    'DM': 10,
    'DO': 10,
    'DZ': 58,
    'EC': 24,
    'EE': 15,
    'EG': 27,
    'ER': 6,
    'ES': 19,
    'ET': 13,
    'FI': 19,
    'FJ': 5,
    'FM': 4,
    'FR': 26,
    'GA': 9,
    'GB': 4,
    'GD': 7,
    'GE': 12,
    'GH': 16,
    'GL': 5,
    'GM': 6,
    'GN': 8,
    'GQ': 2,
    'GR': 14,
    'GT': 22,
    'GW': 4,
    'GY': 10,
    'HN': 18,
    'HR': 21,
    'HT': 10,
    'HU': 43,
    'ID': 7,
    'IE': 4,
    'IL': 6,
    'IN': 36,
    'IQ': 16,
    'IR': 31,
    'IS': 8,
    'IT': 20,
    'JM': 14,
    'JO': 12,
    'JP': 47,
    'KE': 47,
    'KG': 9,
    'KH': 25,
    'KI': 3,
    'KM': 3,
    'KN': 2,
    'KP': 13,
    'KR': 17,
    'KW': 6,
    'KZ': 20,
    'LA': 18,
    'LB': 8,
    'LC': 10,
    'LI': 11,
    'LK': 9,
    'LR': 15,
    'LS': 10,
    'LT': 10,
    'LU': 12,
    'LV': 43,
    'LY': 22,
    'MA': 12,
    'MC': 17,
    'MD': 37,
    'ME': 25,
    'MG': 6,
    'MH': 2,
    'MK': 80,
    'ML': 11,
    'MM': 15,
    'MN': 22,
    'MR': 15,
    'MT': 68,
    'MU': 12,
    'MV': 21,
    'MW': 3,
    'MX': 32,
    'MY': 16,
    'MZ': 11,
    'NA': 14,
    'NE': 8,
    'NG': 37,
    'NI': 17,
    'NL': 18,
    'NO': 13,
    'NP': 7,
    'NR': 14,
    'NZ': 17,
    'OM': 11,
    'PA': 14,
    'PE': 26,
    'PG': 22,
    'PH': 17,
    'PK': 7,
    'PL': 16,
    'PS': 16,
    'PT': 20,
    'PW': 16,
    'PY': 18,
    'QA': 8,
    'RO': 42,
    'RS': 20,
    'RU': 83,
    'RW': 5,
    'SA': 13,
    'SB': 10,
    'SC': 27,
    'SD': 18,
    'SE': 21,
    'SG': 5,
    'SH': 3,
    'SI': 212,
    'SK': 8,
    'SL': 5,
    'SM': 9,
    'SN': 14,
    'SO': 18,
    'SR': 10,
    'SS': 10,
    'ST': 7,
    'SV': 14,
    'SY': 14,
    'SZ': 4,
    'TD': 23,
    'TG': 5,
    'TH': 78,
    'TJ': 5,
    'TL': 13,
    'TM': 6,
    'TN': 24,
    'TO': 5,
    'TR': 81,
    'TT': 15,
    'TV': 8,
    'TW': 22,
    'TZ': 31,
    'UA': 27,
    'UG': 4,
    'UM': 9,
    'US': 57,
    'UY': 19,
    'UZ': 14,
    'VC': 6,
    'VE': 25,
    'VN': 63,
    'VU': 6,
    'WF': 3,
    'WS': 11,
    'YE': 22,
    'ZA': 9,
    'ZM': 10,
    'ZW': 10,
}

# Direct CLDR containment is an intermediate grouping for these territories,
# or CLDR has no country-level group despite a functioning local division.
# Counts and primary-source provenance were reviewed on 2026-09-14.
ADMINISTRATIVE_SUBDIVISION_OVERRIDES = {
    # 26 statutory counties (Tailte Eireann, Government of Ireland).
    # https://data.gov.ie/en_GB/dataset/counties-national-statutory-boundaries-ungeneralised-20261
    'IE': 26,
    # 24 ISO/CLDR municipal divisions below the two geographic island chains;
    # the RMI embassy describes 24 municipal/electoral districts.
    # https://www.rmiembassyus.org/about-2
    'MH': 24,
    # 22 concelhos (municipalities), not the two geographic island groups.
    # https://ine.cv/wp-content/uploads/2022/11/boavista-zonas-e-lugares.pdf
    'CV': 22,
    # Eight provinces, below the two geographic regions (INEGE).
    # https://inege.org/wp-content/uploads/2023/10/Guinea-Ecuatorial-en-Cifras-2022-FINAL.pdf
    'GQ': 8,
    # Eight regions plus the Autonomous Sector of Bissau (national INE).
    # https://www.stat-guinebissau.com/Menu_principal/Pubica%C3%A7%C3%B5es/anuario/boletim_estatistico_GB/GB_Numerofinal_Publica%C3%A7%C3%A3o1.pdf
    'GW': 9,
    # The four regions are statistical groupings; UBOS lists 146 districts as
    # administrative units.
    # https://www.ubos.org/uganda-profile/
    'UG': 146,
    # The three regions contain 28 ISO/CLDR districts; Malawi's NSO publishes
    # its national work by district rather than treating the regions as the
    # destination-level units.
    # https://www.nsomalawi.mw/news/national-census-of-agriculture-interviews
    'MW': 28,
    # Hong Kong Home Affairs Department's 18 districts.
    # https://www.gohk.gov.hk/en/about/index.php
    'HK': 18,
    # 78 functioning municipios (United States Census Bureau).
    # https://www.census.gov/geographies/reference-files/2010/geo/state-local-geo-guides-2010/puerto-rico.html
    'PR': 78,
    # Nine parishes (Government of Bermuda).
    # https://www.gov.bm/sites/default/files/2-Population.pdf
    'BM': 9,
    # Six established districts (Cayman Islands legislation).
    # https://legislation.gov.ky/cms/images/LEGISLATION/SUBORDINATE/2012/2012-0060/2012-0060_SL%2060%20of%202012_g.pdf
    'KY': 6,
    # 12 functioning administrative parishes (Government of Jersey).
    # https://www.gov.je/LifeEvents/MovingToJersey/WhyChooseJersey/Pages/Government.aspx
    'JE': 12,
    # Statistics Faroe Islands publishes the population by 29 municipalities.
    # https://www.hagstova.fo/en/population/population/population
    'FO': 29,
    # Ten inhabited Pa Enua have statutory Island Governments (Office of the
    # Prime Minister, Cook Islands).
    # https://www.pmoffice.gov.ck/our-work/pa-enua/
    'CK': 10,
    # 21 functioning local authorities (Isle of Man Government elections).
    # https://elections.gov.im/local-authority-elections/
    'IM': 21,
    # Nineteen districts/villages with elected mayoral offices (Government of
    # Guam Mayors Council).
    # https://mcog.guam.gov/villages-list
    'GU': 19,
    # Fourteen parishes listed by the national statistics office and law.
    # https://www.stats.gov.kn/topics/demographic-social-statistics/population/parish-size-population-and-density-1991-2011/
    'KN': 14,
    # Ten current electoral districts published by the TCI Government.
    # https://www.gov.tc/elections/media-center/latest-news/tci-2024-2025-electors-list
    'TC': 10,
    # France's official geographic code lists the functioning communes within
    # these overseas departments/territories. These are the first useful
    # destination divisions within the territory shown as a Wayfinder country.
    # https://www.insee.fr/fr/information/7766585
    'GP': 32,
    'MQ': 34,
    'GF': 22,
    'RE': 24,
    'YT': 17,
}

NAVIGATION_SUBDIVISION_COUNTS = {
    **FIRST_LEVEL_SUBDIVISION_COUNTS,
    **ADMINISTRATIVE_SUBDIVISION_OVERRIDES,
}
