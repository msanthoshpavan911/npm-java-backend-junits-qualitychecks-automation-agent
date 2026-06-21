import subprocess

def impact_analyzer():

    result = subprocess.check_output(
        ["git", "diff", "--cached", "--name-only"]
    )

    return result.decode()