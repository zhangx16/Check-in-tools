module.exports = function createService(context) {
  const { fs, PROJECT_NAMES_FILE } = context;
  function readProjectNames() {
    if (!fs.existsSync(PROJECT_NAMES_FILE)) return {};
    const names = JSON.parse(fs.readFileSync(PROJECT_NAMES_FILE, "utf8"));
    if (!names || typeof names !== "object" || Array.isArray(names))
      throw new Error("项目名称配置格式错误");
    return names;
  }
  function setProjectName(id, name) {
    const names = readProjectNames();
    const key = id.toLowerCase();
    if (name) names[key] = name;
    else delete names[key];
    fs.writeFileSync(
      `${PROJECT_NAMES_FILE}.tmp`,
      JSON.stringify(names, null, 2),
    );
    fs.renameSync(`${PROJECT_NAMES_FILE}.tmp`, PROJECT_NAMES_FILE);
  }
  function applyProjectNames(projects) {
    const names = readProjectNames();
    return projects.map((project) => ({
      ...project,
      defaultTitle: project.defaultTitle || project.title,
      title:
        names[project.id.toLowerCase()] ||
        project.defaultTitle ||
        project.title,
    }));
  }

  return { readProjectNames, setProjectName, applyProjectNames };
};
