import os

def repository_indexer():

    controllers = []
    services = []
    repositories = []
    entities = []
    configs = []

    for root, dirs, files in os.walk("."):

        for file in files:

            if file.endswith("Controller.java"):
                controllers.append(
                    os.path.join(root, file)
                )

            elif file.endswith("Service.java"):
                services.append(
                    os.path.join(root, file)
                )

            elif file.endswith("Repository.java"):
                repositories.append(
                    os.path.join(root, file)
                )

            elif file.endswith("Entity.java"):
                entities.append(
                    os.path.join(root, file)
                )

            elif file.endswith("Config.java"):
                configs.append(
                    os.path.join(root, file)
                )

    output = "# Repository Index\n\n"

    output += "## Controllers\n"

    for item in controllers:
        output += f"- {item}\n"

    output += "\n## Services\n"

    for item in services:
        output += f"- {item}\n"

    output += "\n## Repositories\n"

    for item in repositories:
        output += f"- {item}\n"

    output += "\n## Entities\n"

    for item in entities:
        output += f"- {item}\n"

    output += "\n## Configurations\n"

    for item in configs:
        output += f"- {item}\n"

    os.makedirs("docs", exist_ok=True)

    with open(
        "docs/repository-index.md",
        "w",
        encoding="utf-8"
    ) as file:
        file.write(output)

    return "repository-index.md generated successfully"