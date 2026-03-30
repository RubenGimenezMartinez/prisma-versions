export namespace main {
	
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

}

