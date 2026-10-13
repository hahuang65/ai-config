use crate::cli::Scope;
use crate::error::{Error, Result};
use crate::git;
use crate::model::{Log, Project, same_project};

pub enum Selection {
    All,
    One(Option<Project>),
}

impl Selection {
    pub fn resolve(scope: &Scope, log: &Log) -> Result<Self> {
        if scope.all_projects {
            return Ok(Self::All);
        }
        if scope.unassigned {
            return Ok(Self::One(None));
        }
        if let Some(name) = &scope.project {
            let matches: Vec<_> = log
                .projects()
                .into_iter()
                .filter(|project| project.name == *name || project.id == *name)
                .collect();
            return match matches.as_slice() {
                [project] => Ok(Self::One(Some(project.clone()))),
                [] => Err(Error::usage(
                    "unknown project; use projects or --project-path to an existing repository",
                )),
                _ => Err(Error::usage(
                    "ambiguous project name; use an exact ID from projects or --project-path",
                )),
            };
        }
        let path = match &scope.project_path {
            Some(path) => path.clone(),
            None => std::env::current_dir()
                .map_err(|_| Error::usage("cannot access current directory; use --project-path"))?,
        };
        Ok(Self::One(Some(git::discover(&path)?)))
    }

    pub fn matches(&self, project: &Option<Project>) -> bool {
        match self {
            Self::All => true,
            Self::One(selected) => same_project(selected, project),
        }
    }

    pub fn project(&self) -> Result<Option<Project>> {
        match self {
            Self::One(project) => Ok(project.clone()),
            Self::All => Err(Error::usage("writes require one project")),
        }
    }
}
