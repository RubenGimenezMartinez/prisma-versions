export namespace main {
	
	export class SavedRepository {
	    name: string;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new SavedRepository(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	    }
	}
	export class AppState {
	    currentUser: string;
	    users: string[];
	    repoPath: string;
	    repositories: SavedRepository[];
	
	    static createFrom(source: any = {}) {
	        return new AppState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.currentUser = source["currentUser"];
	        this.users = source["users"];
	        this.repoPath = source["repoPath"];
	        this.repositories = this.convertValues(source["repositories"], SavedRepository);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BranchSourceValue {
	    sourceId: string;
	    name: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new BranchSourceValue(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sourceId = source["sourceId"];
	        this.name = source["name"];
	        this.value = source["value"];
	    }
	}
	export class BranchGroupedResult {
	    branch: string;
	    items: BranchSourceValue[];
	
	    static createFrom(source: any = {}) {
	        return new BranchGroupedResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.branch = source["branch"];
	        this.items = this.convertValues(source["items"], BranchSourceValue);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class BranchVersion {
	    branch: string;
	    version: string;
	
	    static createFrom(source: any = {}) {
	        return new BranchVersion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.branch = source["branch"];
	        this.version = source["version"];
	    }
	}
	export class PatternPreview {
	    status: string;
	    extracted: string;
	    formatted: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new PatternPreview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.extracted = source["extracted"];
	        this.formatted = source["formatted"];
	        this.message = source["message"];
	    }
	}
	export class RepoVersionSource {
	    id: string;
	    name: string;
	    filePath: string;
	    pattern: string;
	    favorite: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RepoVersionSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.filePath = source["filePath"];
	        this.pattern = source["pattern"];
	        this.favorite = source["favorite"];
	    }
	}
	export class RepoPreferences {
	    versionFile?: string;
	    selectedBranches: string[];
	    favoriteBranches: string[];
	    branchTypes: Record<string, string>;
	    versionSources: RepoVersionSource[];
	    selectedSourceIds: string[];
	
	    static createFrom(source: any = {}) {
	        return new RepoPreferences(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.versionFile = source["versionFile"];
	        this.selectedBranches = source["selectedBranches"];
	        this.favoriteBranches = source["favoriteBranches"];
	        this.branchTypes = source["branchTypes"];
	        this.versionSources = this.convertValues(source["versionSources"], RepoVersionSource);
	        this.selectedSourceIds = source["selectedSourceIds"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

