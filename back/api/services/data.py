DISTRICT_ORDER = [
    "Алмалинский",
    "Бостандыкский",
    "Медеуский",
    "Ауэзовский",
    "Алатауский",
    "Жетысуский",
    "Турксибский",
    "Наурызбайский",
]

ALMATY_MAP_CONFIG = {
    "center": [43.238949, 76.889709],
    "nodes": [
        {
            "id": "central-hub",
            "title": "Central Dispatch Hub",
            "type": "dispatch",
            "position": [43.2447, 76.9154],
        },
        {
            "id": "south-reservoir",
            "title": "South Reservoir",
            "type": "reservoir",
            "position": [43.1927, 76.9231],
        },
        {
            "id": "west-plant",
            "title": "West Treatment",
            "type": "treatment",
            "position": [43.2384, 76.8078],
        },
    ],
    "districts": {
        "Алмалинский": {"position": [43.2565, 76.9284], "source": "central-hub"},
        "Бостандыкский": {"position": [43.2209, 76.9142], "source": "south-reservoir"},
        "Медеуский": {"position": [43.2463, 76.9759], "source": "south-reservoir"},
        "Ауэзовский": {"position": [43.2298, 76.8407], "source": "west-plant"},
        "Алатауский": {"position": [43.2588, 76.8205], "source": "west-plant"},
        "Жетысуский": {"position": [43.2892, 76.9031], "source": "central-hub"},
        "Турксибский": {"position": [43.3134, 76.9407], "source": "central-hub"},
        "Наурызбайский": {"position": [43.1815, 76.8175], "source": "west-plant"},
    },
}
